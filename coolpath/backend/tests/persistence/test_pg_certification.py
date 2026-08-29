"""
Phase 5.2 — Real PostgreSQL Certification Test Suite

This test suite verifies the entire Phase 5 persistence architecture
against a live PostgreSQL instance. It does NOT use SQLite.

Requirements:
  - DATABASE_URL environment variable must point to a real PostgreSQL instance.
  - Alembic migration must have been applied (alembic upgrade head).

Run:
  $env:DATABASE_URL = "<your-pg-url>"; $env:PYTHONPATH = "."; pytest tests/persistence/test_pg_certification.py -v
"""
import os
import uuid
import pytest
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, Session

from app.config import (
    APP_DATABASE_URL,
    APP_DATABASE_URL_IS_CONFIGURED,
    CHECKPOINT_DATABASE_URL,
)
from app.db.database import Base
from app.db.models import (
    WorkOrderModel,
    DispatchMissionModel,
    ThermalEvidenceModel,
    ThermalPolicyModel,
    CandidatePlanModel,
    DispatchDecisionModel,
    DecisionEventModel,
)
from app.repositories.mission_repository import MissionRepository, VersionConflictError
from app.repositories.decision_repository import DecisionRepository
from app.repositories.evidence_repository import EvidenceRepository
from app.services.mission_version_store import PostgresMissionVersionStore
from app.models.mission import DispatchMissionState, Coordinate
from app.models.evidence import ThermalEvidence
from app.models.action import DispatchDecision
from app.models.feasibility import MissionFeasibility
from app.models.reason_codes import ReasonCode
from app.models.policy import ThermalPolicy
from app.decision.selector import DecisionSelector
from app.decision.thermal_capacity import ThermalCapacityAdapter


# ─── Fixtures ──────────────────────────────────────────────────────────────────

if not APP_DATABASE_URL_IS_CONFIGURED or "postgresql" not in APP_DATABASE_URL:
    pytest.skip(
        "Skipping PostgreSQL certification: DATABASE_URL/SUPABASE_DB_URL not set or not PostgreSQL",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def pg_engine():
    """Create a module-scoped engine to the real PostgreSQL database."""
    engine = create_engine(APP_DATABASE_URL, pool_pre_ping=True)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def pg_session(pg_engine):
    """
    Create a function-scoped session that wraps each test in a transaction
    and rolls back after completion so tests are isolated and the database
    stays clean.
    """
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def unique_id():
    return str(uuid.uuid4())


def _make_mission_state(uid: str, version: int = 1) -> DispatchMissionState:
    now = datetime.now(timezone.utc)
    return DispatchMissionState(
        session_id=uid,
        work_order_id=f"wo_{uid}",
        task_type="line_repair",
        crew_id="crew_alpha",
        crew_location=Coordinate(lat=40.7128, lng=-74.006),
        job_location=Coordinate(lat=40.758, lng=-73.985),
        estimated_outdoor_minutes=30,
        priority="NORMAL",
        sla_deadline=now + timedelta(hours=2),
        max_dispatch_delay_minutes=60,
        thermal_policy_id="pol_1",
        thermal_policy_version="v1",
        mission_version=version,
        created_at=now,
        updated_at=now,
    )


def _make_evidence(uid: str, data_mode: str = "LIVE") -> ThermalEvidence:
    return ThermalEvidence(
        evidence_id=f"evt_{uid}",
        provider="fortyguard",
        requested_at=datetime.now(timezone.utc),
        observed_at=datetime.now(timezone.utc),
        data_mode=data_mode,
        metric="tcm",
        unit="TEMP_TIME_PROXY_C_MIN",
        freshness_seconds=30,
        freshness_status="FRESH",
        coverage_status="OK",
    )


def _make_policy() -> ThermalPolicy:
    return ThermalPolicy(
        policy_id="pol_1",
        policy_version="v1",
        metric="TEMP_TIME_PROXY_C_MIN",
        threshold=1000.0,
        max_continuous_outdoor_minutes=60,
        allow_emergency_override=False,
        supervisor_approval_required=True,
    )


def _make_feasibility(uid: str, evidence_id: str) -> MissionFeasibility:
    now = datetime.now(timezone.utc)
    return MissionFeasibility(
        candidate_id=f"cand_{uid}",
        route_id="fastest",
        feasible=True,
        sla_met=True,
        thermal_policy_met=True,
        priority_policy_met=None,
        departure_offset_minutes=0,
        departure_at=now,
        travel_minutes=25.0,
        outdoor_minutes=30.0,
        completion_time=now + timedelta(minutes=55),
        calculated_exposure=750.0,
        unit="TEMP_TIME_PROXY_C_MIN",
        violations=[],
        warnings=[],
        thermal_evidence_id=evidence_id,
    )


# ─── 1. CONNECTION VERIFICATION ───────────────────────────────────────────────

class TestPostgresConnection:
    def test_actual_pg_version(self, pg_engine):
        """Verify we are connected to real PostgreSQL, not SQLite."""
        with pg_engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version_str = result.scalar()
            assert "PostgreSQL" in version_str
            print(f"\n  PostgreSQL version: {version_str}")


# ─── 2. SCHEMA VERIFICATION ──────────────────────────────────────────────────

class TestSchemaIntegrity:
    EXPECTED_TABLES = [
        "work_orders",
        "dispatch_missions",
        "thermal_policies",
        "thermal_evidence",
        "candidate_plans",
        "dispatch_decisions",
        "decision_events",
    ]

    def test_all_domain_tables_exist(self, pg_engine):
        inspector = inspect(pg_engine)
        tables = inspector.get_table_names()
        for t in self.EXPECTED_TABLES:
            assert t in tables, f"Missing table: {t}"

    def test_foreign_keys_exist(self, pg_engine):
        inspector = inspect(pg_engine)
        fks = inspector.get_foreign_keys("dispatch_missions")
        fk_cols = {fk["constrained_columns"][0] for fk in fks}
        assert "work_order_id" in fk_cols

    def test_idempotency_unique_constraint(self, pg_engine):
        inspector = inspect(pg_engine)
        uniques = inspector.get_unique_constraints("decision_events")
        unique_cols = set()
        for u in uniques:
            unique_cols.update(u["column_names"])
        assert "idempotency_key" in unique_cols

    def test_timestamp_columns_are_timezone_aware(self, pg_engine):
        inspector = inspect(pg_engine)
        cols = {c["name"]: c for c in inspector.get_columns("dispatch_missions")}
        sla_col = cols["sla_deadline"]
        assert sla_col["type"].timezone is True, (
            "sla_deadline must be timestamp WITH time zone"
        )


# ─── 3. MISSION REPOSITORY ───────────────────────────────────────────────────

class TestMissionRepository:
    def test_create_and_load_mission(self, pg_session, unique_id):
        repo = MissionRepository(pg_session)
        state = _make_mission_state(unique_id)
        repo.create_mission(state)
        pg_session.flush()

        loaded = repo.get_mission(unique_id)
        assert loaded is not None
        assert loaded.session_id == unique_id
        assert loaded.crew_id == "crew_alpha"
        assert loaded.mission_version == 1

    def test_update_mission_increments_version(self, pg_session, unique_id):
        repo = MissionRepository(pg_session)
        state = _make_mission_state(unique_id)
        repo.create_mission(state)
        pg_session.flush()

        updated = repo.update_mission_optimistic(state, expected_version=1)
        assert updated.mission_version == 2


# ─── 4. OPTIMISTIC CONCURRENCY ON POSTGRESQL ─────────────────────────────────

class TestOptimisticConcurrency:
    def test_version_conflict_raises(self, pg_engine, unique_id):
        """
        Two independent sessions: A succeeds, B gets VersionConflictError.
        This proves database-level enforcement, not application-level.
        """
        # Setup: create mission in session A
        session_a = sessionmaker(bind=pg_engine)()
        repo_a = MissionRepository(session_a)
        state = _make_mission_state(unique_id)
        repo_a.create_mission(state)
        session_a.commit()

        try:
            # Session A: update version 1 → 2
            state_a = _make_mission_state(unique_id, version=1)
            repo_a.update_mission_optimistic(state_a, expected_version=1)
            session_a.commit()

            # Session B: attempt stale update expecting version 1
            session_b = sessionmaker(bind=pg_engine)()
            repo_b = MissionRepository(session_b)
            state_b = _make_mission_state(unique_id, version=1)

            with pytest.raises(VersionConflictError):
                repo_b.update_mission_optimistic(state_b, expected_version=1)

            session_b.close()
        finally:
            # Clean up
            session_a.execute(
                text("DELETE FROM dispatch_missions WHERE id = :id"), {"id": unique_id}
            )
            session_a.execute(
                text("DELETE FROM work_orders WHERE id = :id"), {"id": f"wo_{unique_id}"}
            )
            session_a.commit()
            session_a.close()


# ─── 5. EVIDENCE REPOSITORY ──────────────────────────────────────────────────

class TestEvidenceRepository:
    def test_persist_and_verify(self, pg_session, unique_id):
        repo = EvidenceRepository(pg_session)
        evidence = _make_evidence(unique_id, data_mode="LIVE")
        repo.persist_evidence(evidence)
        pg_session.flush()

        model = pg_session.query(ThermalEvidenceModel).filter_by(
            id=f"evt_{unique_id}"
        ).first()
        assert model is not None
        assert model.data_mode == "LIVE"
        assert model.metric == "tcm"


# ─── 6. PROVENANCE ROUND-TRIP ────────────────────────────────────────────────

class TestProvenanceRoundTrip:
    @pytest.mark.parametrize(
        "data_mode", ["LIVE", "CACHED", "FALLBACK", "SIMULATED", "DEGRADED"]
    )
    def test_data_mode_preserved(self, pg_session, data_mode):
        uid = str(uuid.uuid4())
        repo = EvidenceRepository(pg_session)
        evidence = _make_evidence(uid, data_mode=data_mode)
        repo.persist_evidence(evidence)
        pg_session.flush()

        model = pg_session.query(ThermalEvidenceModel).filter_by(
            id=f"evt_{uid}"
        ).first()
        assert model.data_mode == data_mode, (
            f"Serialization changed mode from {data_mode} to {model.data_mode}"
        )
        assert model.freshness_state == "FRESH"
        assert model.provider == "fortyguard"
        assert model.metric == "tcm"
        assert model.unit == "TEMP_TIME_PROXY_C_MIN"


# ─── 7. DECISION REPOSITORY ──────────────────────────────────────────────────

class TestDecisionRepository:
    def test_persist_decision_and_candidates(self, pg_session, unique_id):
        # Pre-requisites: mission + evidence
        mission_repo = MissionRepository(pg_session)
        evidence_repo = EvidenceRepository(pg_session)
        decision_repo = DecisionRepository(pg_session)

        state = _make_mission_state(unique_id)
        mission_repo.create_mission(state)

        evidence = _make_evidence(unique_id)
        evidence_repo.persist_evidence(evidence)
        pg_session.flush()

        decision = DispatchDecision(
            action="DISPATCH_NOW",
            candidate_id=f"cand_{unique_id}",
            reason_codes=[ReasonCode.SLA_MET, ReasonCode.THERMAL_POLICY_MET],
            approval_required=False,
            evidence_id=f"evt_{unique_id}",
            mission_version=1,
        )
        feasibility = _make_feasibility(unique_id, f"evt_{unique_id}")

        d_model = decision_repo.persist_decision_and_candidates(
            mission_id=unique_id,
            decision=decision,
            candidates=[feasibility],
            policy_id="pol_1",
            policy_version="v1",
            evaluation_time=datetime.now(timezone.utc),
        )
        pg_session.flush()

        assert d_model.id is not None
        assert d_model.action == "DISPATCH_NOW"
        assert d_model.mission_id == unique_id

        # Verify candidates were persisted
        candidates = pg_session.query(CandidatePlanModel).filter_by(
            decision_id=d_model.id
        ).all()
        assert len(candidates) == 1
        assert candidates[0].candidate_id == f"cand_{unique_id}"


# ─── 8. APPEND-ONLY EVENT HISTORY ────────────────────────────────────────────

class TestAppendOnlyEvents:
    def test_events_are_append_only(self, pg_session, unique_id):
        mission_repo = MissionRepository(pg_session)
        decision_repo = DecisionRepository(pg_session)

        state = _make_mission_state(unique_id)
        mission_repo.create_mission(state)
        pg_session.flush()

        # Append first event
        evt1 = decision_repo.append_decision_event(
            event_type="SYSTEM_RECOMMENDATION",
            mission_id=unique_id,
            mission_version=1,
            actor_type="SYSTEM",
            reason_codes=["SLA_MET"],
        )
        pg_session.flush()

        # Append second event (new recommendation, not mutation)
        evt2 = decision_repo.append_decision_event(
            event_type="SYSTEM_RECOMMENDATION",
            mission_id=unique_id,
            mission_version=2,
            actor_type="SYSTEM",
            reason_codes=["THERMAL_POLICY_MET"],
        )
        pg_session.flush()

        events = pg_session.query(DecisionEventModel).filter_by(
            mission_id=unique_id
        ).order_by(DecisionEventModel.created_at).all()

        assert len(events) == 2
        assert events[0].id != events[1].id
        assert events[0].mission_version == 1
        assert events[1].mission_version == 2

    def test_no_update_delete_on_events(self):
        """
        Verify DecisionRepository has no update/delete methods for events.
        This is a structural, not runtime, guarantee.
        """
        methods = dir(DecisionRepository)
        assert "update_decision_event" not in methods
        assert "delete_decision_event" not in methods


# ─── 9. IDEMPOTENCY ──────────────────────────────────────────────────────────

class TestIdempotency:
    def test_duplicate_idempotency_key_raises(self, pg_engine, unique_id):
        """
        Verify database-level uniqueness for idempotency_key on decision_events.
        """
        session = sessionmaker(bind=pg_engine)()
        try:
            # Create pre-requisite mission
            mission_repo = MissionRepository(session)
            state = _make_mission_state(unique_id)
            mission_repo.create_mission(state)
            session.commit()

            decision_repo = DecisionRepository(session)
            idem_key = f"idem_{unique_id}"

            decision_repo.append_decision_event(
                event_type="SYSTEM_RECOMMENDATION",
                mission_id=unique_id,
                mission_version=1,
                actor_type="SYSTEM",
                idempotency_key=idem_key,
            )
            session.commit()

            # Duplicate should raise IntegrityError
            from sqlalchemy.exc import IntegrityError

            with pytest.raises(IntegrityError):
                decision_repo.append_decision_event(
                    event_type="SYSTEM_RECOMMENDATION",
                    mission_id=unique_id,
                    mission_version=1,
                    actor_type="SYSTEM",
                    idempotency_key=idem_key,
                )
                session.flush()
        finally:
            session.rollback()
            session.execute(
                text("DELETE FROM decision_events WHERE mission_id = :id"), {"id": unique_id}
            )
            session.execute(
                text("DELETE FROM dispatch_missions WHERE id = :id"), {"id": unique_id}
            )
            session.execute(
                text("DELETE FROM work_orders WHERE id = :id"), {"id": f"wo_{unique_id}"}
            )
            session.commit()
            session.close()


# ─── 10. POSTGRES MISSION VERSION STORE ───────────────────────────────────────

class TestPostgresMissionVersionStore:
    def test_get_latest_version(self, pg_session, unique_id):
        mission_repo = MissionRepository(pg_session)
        state = _make_mission_state(unique_id, version=1)
        mission_repo.create_mission(state)
        pg_session.flush()

        store = PostgresMissionVersionStore(pg_session)
        assert store.get_latest_version(unique_id) == 1

    def test_is_superseded(self, pg_session, unique_id):
        mission_repo = MissionRepository(pg_session)
        state = _make_mission_state(unique_id, version=1)
        mission_repo.create_mission(state)
        pg_session.flush()

        # Bump to version 2
        mission_repo.update_mission_optimistic(state, expected_version=1)
        pg_session.flush()

        store = PostgresMissionVersionStore(pg_session)
        # Evaluation started at version 1, but DB is now at version 2
        assert store.is_superseded(unique_id, evaluation_version=1) is True
        # Current version matches, not superseded
        assert store.is_superseded(unique_id, evaluation_version=2) is False

    def test_nonexistent_mission_not_superseded(self, pg_session):
        store = PostgresMissionVersionStore(pg_session)
        assert store.is_superseded("nonexistent", evaluation_version=1) is False


# ─── 11. TRANSACTION ATOMICITY ────────────────────────────────────────────────

class TestTransactionAtomicity:
    def test_rollback_leaves_no_partial_state(self, pg_engine, unique_id):
        """
        Simulate a failure mid-transaction. Verify nothing is persisted.
        """
        session = sessionmaker(bind=pg_engine)()
        try:
            mission_repo = MissionRepository(session)
            evidence_repo = EvidenceRepository(session)
            decision_repo = DecisionRepository(session)

            state = _make_mission_state(unique_id)
            mission_repo.create_mission(state)

            evidence = _make_evidence(unique_id)
            evidence_repo.persist_evidence(evidence)

            decision = DispatchDecision(
                action="DISPATCH_NOW",
                candidate_id=f"cand_{unique_id}",
                reason_codes=[ReasonCode.SLA_MET],
                approval_required=False,
                evidence_id=f"evt_{unique_id}",
                mission_version=1,
            )
            feasibility = _make_feasibility(unique_id, f"evt_{unique_id}")
            decision_repo.persist_decision_and_candidates(
                mission_id=unique_id,
                decision=decision,
                candidates=[feasibility],
                policy_id="pol_1",
                policy_version="v1",
                evaluation_time=datetime.now(timezone.utc),
            )

            # Simulate failure: rollback before commit
            session.rollback()
        finally:
            session.close()

        # Verify with a clean session
        verify_session = sessionmaker(bind=pg_engine)()
        try:
            assert verify_session.query(DispatchMissionModel).filter_by(id=unique_id).first() is None
            assert verify_session.query(ThermalEvidenceModel).filter_by(id=f"evt_{unique_id}").first() is None
            assert verify_session.query(DispatchDecisionModel).filter_by(mission_id=unique_id).first() is None
            assert verify_session.query(DecisionEventModel).filter_by(mission_id=unique_id).first() is None
        finally:
            verify_session.close()


# ─── 12. TIMEZONE-AWARE TIMESTAMP ROUND-TRIP ──────────────────────────────────

class TestTimestampRoundTrip:
    def test_timezone_aware_timestamps_preserved(self, pg_session, unique_id):
        """Verify timezone-aware datetimes round-trip correctly through PostgreSQL."""
        now = datetime.now(timezone.utc)
        sla = now + timedelta(hours=2)

        state = _make_mission_state(unique_id)
        state.sla_deadline = sla

        mission_repo = MissionRepository(pg_session)
        mission_repo.create_mission(state)
        pg_session.flush()

        model = pg_session.query(DispatchMissionModel).filter_by(id=unique_id).first()
        assert model.sla_deadline.tzinfo is not None, "Timestamp lost timezone info"
        # Allow microsecond-level rounding differences
        delta = abs((model.sla_deadline - sla).total_seconds())
        assert delta < 1.0, f"Timestamp drift: {delta}s"


# ─── 13. DETERMINISTIC REPLAY FROM POSTGRESQL ────────────────────────────────

class TestDeterministicReplay:
    def test_persist_and_replay_decision(self, pg_session, unique_id):
        """
        Persist a complete decision snapshot, reload from PostgreSQL,
        and replay the deterministic engine to get the same result.
        """
        # Setup: mission + evidence + policy
        mission_repo = MissionRepository(pg_session)
        evidence_repo = EvidenceRepository(pg_session)
        decision_repo = DecisionRepository(pg_session)

        state = _make_mission_state(unique_id)
        mission_repo.create_mission(state)

        evidence = _make_evidence(unique_id, data_mode="LIVE")
        evidence_repo.persist_evidence(evidence)
        pg_session.flush()

        policy = _make_policy()

        # Generate feasibility deterministically
        now = datetime.now(timezone.utc)
        feasibility = ThermalCapacityAdapter.evaluate_candidate(
            candidate_id=f"cand_{unique_id}",
            route_id="fastest",
            departure_at=now,
            departure_offset_minutes=0,
            travel_minutes=25.0,
            outdoor_minutes=30.0,
            sla_deadline=now + timedelta(hours=2),
            priority="NORMAL",
            thermal_policy=policy,
            thermal_evidence=evidence,
            calculated_exposure=750.0,
            unit="TEMP_TIME_PROXY_C_MIN",
        )

        # Run decision engine
        original_decision = DecisionSelector.select_decision(
            feasibilities=[feasibility],
            mission_state=state,
            base_time=now,
            current_route_id="fastest",
        )

        # Persist decision
        decision_repo.persist_decision_and_candidates(
            mission_id=unique_id,
            decision=original_decision,
            candidates=[feasibility],
            policy_id="pol_1",
            policy_version="v1",
            evaluation_time=now,
        )
        pg_session.flush()

        # --- RELOAD from PostgreSQL ---
        loaded_decision_model = pg_session.query(DispatchDecisionModel).filter_by(
            mission_id=unique_id
        ).first()
        loaded_candidates = pg_session.query(CandidatePlanModel).filter_by(
            decision_id=loaded_decision_model.id
        ).all()

        # Reconstruct feasibility from loaded data
        reconstructed_feasibility = MissionFeasibility(
            candidate_id=loaded_candidates[0].candidate_id,
            route_id=loaded_candidates[0].route_id,
            feasible=loaded_candidates[0].sla_met and (loaded_candidates[0].thermal_policy_met is True),
            sla_met=loaded_candidates[0].sla_met,
            thermal_policy_met=loaded_candidates[0].thermal_policy_met,
            priority_policy_met=loaded_candidates[0].priority_policy_met,
            departure_offset_minutes=loaded_candidates[0].departure_offset_minutes,
            departure_at=loaded_candidates[0].departure_at,
            travel_minutes=loaded_candidates[0].travel_minutes,
            outdoor_minutes=loaded_candidates[0].outdoor_minutes,
            completion_time=loaded_candidates[0].completion_time,
            calculated_exposure=loaded_candidates[0].calculated_exposure,
            unit=loaded_candidates[0].unit,
            violations=loaded_candidates[0].violations or [],
            warnings=loaded_candidates[0].warnings or [],
            thermal_evidence_id=loaded_candidates[0].thermal_evidence_id,
        )

        # Replay decision engine with same inputs
        replayed_decision = DecisionSelector.select_decision(
            feasibilities=[reconstructed_feasibility],
            mission_state=state,
            base_time=now,
            current_route_id="fastest",
        )

        assert replayed_decision.action == original_decision.action
        assert replayed_decision.candidate_id == original_decision.candidate_id
        assert set(rc.value for rc in replayed_decision.reason_codes) == set(
            rc.value for rc in original_decision.reason_codes
        )


# ─── 14. POSTGRESQL POSTGRESSAVER ────────────────────────────────────────────

class TestPostgresSaver:
    def test_save_and_resume_checkpoint(self, pg_engine):
        """
        Verify LangGraph PostgresSaver can save a checkpoint and resume it
        after completely destroying and recreating the runtime.
        """
        from langgraph.checkpoint.postgres import PostgresSaver as PGSaver
        from psycopg_pool import ConnectionPool

        pool = ConnectionPool(
            conninfo=CHECKPOINT_DATABASE_URL,
            min_size=1,
            max_size=3,
            kwargs={"autocommit": True},
        )
        try:
            saver = PGSaver(pool)
            saver.setup()

            thread_id = str(uuid.uuid4())
            config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}

            # Create a minimal checkpoint
            checkpoint = {
                "v": 1,
                "id": str(uuid.uuid4()),
                "ts": datetime.now(timezone.utc).isoformat(),
                "channel_values": {"test_key": "test_value"},
                "channel_versions": {},
                "versions_seen": {},
                "pending_sends": [],
            }
            checkpoint_metadata = {"source": "test", "step": 0, "writes": {}}

            saved = saver.put(config, checkpoint, checkpoint_metadata, {})
            assert saved is not None
            print(f"\n  Saved checkpoint config: {saved}")

            # Simulate runtime destruction: close pool and create new one
            pool.close()
            pool2 = ConnectionPool(
                conninfo=CHECKPOINT_DATABASE_URL,
                min_size=1,
                max_size=3,
                kwargs={"autocommit": True},
            )
            saver2 = PGSaver(pool2)

            # Resume from the same thread_id
            loaded = saver2.get(config)
            assert loaded is not None
            assert loaded["channel_values"]["test_key"] == "test_value"
            print(f"\n  Resumed checkpoint: channel_values={loaded['channel_values']}")

            pool2.close()
        except Exception:
            pool.close()
            raise


# ─── 15. PRODUCTION FAILURE BEHAVIOR ─────────────────────────────────────────

class TestProductionFailureBehavior:
    def test_production_does_not_silently_downgrade(self):
        """
        Verify that create_checkpointer() with ENVIRONMENT=production
        and an unreachable DATABASE_URL will hard-fail (sys.exit),
        NOT silently fall back to MemorySaver.
        """
        import subprocess
        import sys
        import os

        script = (
            'import os; '
            'os.environ["ENVIRONMENT"] = "production"; '
            'os.environ["DATABASE_URL"] = "postgresql://invalid"; '
            'import sys; sys.path.insert(0, "."); '
            'from unittest.mock import patch; '
            'patch("psycopg_pool.ConnectionPool", side_effect=Exception("Mocked DB failure")).start(); '
            'import app.agent.graph'
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            timeout=10,
        )
        # Should exit with non-zero (sys.exit(1))
        assert result.returncode != 0, (
            f"Production checkpoint failure must NOT succeed silently. "
            f"stdout: {result.stdout}, stderr: {result.stderr}"
        )


# ─── 16. DATABASE FAILURE BEHAVIOR ───────────────────────────────────────────

class TestDatabaseFailureBehavior:
    def test_connection_failure_raises_typed_error(self):
        """Verify that connecting to an unreachable DB raises, not hangs."""
        bad_engine = create_engine(
            "postgresql://bad:bad@localhost:59999/nonexistent",
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3},
        )
        from sqlalchemy.exc import OperationalError

        with pytest.raises(OperationalError):
            with bad_engine.connect() as conn:
                conn.execute(text("SELECT 1"))

        bad_engine.dispose()


# ─── 17. SQLITE USAGE AUDIT ──────────────────────────────────────────────────

class TestSQLiteAudit:
    def test_no_sqlite_in_production_code(self):
        """
        Verify that SQLite connection strings are NOT in production application code.
        Only test files should reference sqlite.
        """
        import glob

        app_files = glob.glob(
            os.path.join(os.path.dirname(__file__), "..", "..", "app", "**", "*.py"),
            recursive=True,
        )
        for fpath in app_files:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                assert "sqlite:///" not in content, (
                    f"Production code references SQLite: {fpath}"
                )
