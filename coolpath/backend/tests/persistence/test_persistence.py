import pytest
from datetime import datetime, timezone, timedelta
from app.db.models import DecisionEventModel, DispatchDecisionModel, CandidatePlanModel
from app.repositories.decision_repository import DecisionRepository
from app.models.action import DispatchDecision, ReasonCode
from app.models.feasibility import MissionFeasibility
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base

engine = create_engine("sqlite:///:memory:")
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    # We must insert dummy mission and evidence since there are foreign keys
    # However, SQLite in-memory ignores foreign key constraints by default unless PRAGMA foreign_keys=ON
    # We can just insert them or leave them dangling. SQLite will allow it.
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)

def test_persist_decision_and_events(db_session):
    repo = DecisionRepository(db_session)
    
    # 1. Create dummy decision
    decision = DispatchDecision(
        mission_id="m_1",
        mission_version=1,
        candidate_id="c_1",
        action="DISPATCH_NOW",
        reason_codes=[ReasonCode.THERMAL_POLICY_MET],
        evidence_id="ev_1",
        approval_required=False
    )
    
    # 2. Create dummy candidate
    candidate = MissionFeasibility(
        candidate_id="c_1",
        route_id="fastest",
        departure_offset_minutes=0,
        departure_at=datetime.now(timezone.utc),
        travel_minutes=30.0,
        outdoor_minutes=30.0,
        completion_time=datetime.now(timezone.utc) + timedelta(minutes=60),
        calculated_exposure=800.0,
        unit="TEMP_TIME_PROXY_C_MIN",
        sla_met=True,
        thermal_policy_met=True,
        priority_policy_met=True,
        feasible=True,
        violations=[],
        warnings=[],
        thermal_evidence_id="ev_1"
    )
    
    # Persist
    decision_model = repo.persist_decision_and_candidates(
        mission_id="m_1",
        decision=decision,
        candidates=[candidate],
        policy_id="pol_1",
        policy_version="v1",
        evaluation_time=datetime.now(timezone.utc)
    )
    db_session.commit()
    
    assert decision_model.id is not None
    assert decision_model.action == "DISPATCH_NOW"
    
    # Validate candidate persisted
    c_model = db_session.query(CandidatePlanModel).filter_by(decision_id=decision_model.id).first()
    assert c_model is not None
    assert c_model.candidate_id == "c_1"
    
    # 3. Append Event
    event_model = repo.append_decision_event(
        event_type="DECISION_SELECTED",
        mission_id="m_1",
        mission_version=1,
        decision_id=decision_model.id,
        reason_codes=["THERMAL_POLICY_MET"],
        payload={"action": "DISPATCH_NOW"}
    )
    db_session.commit()
    
    assert event_model.id is not None
    assert event_model.event_type == "DECISION_SELECTED"
