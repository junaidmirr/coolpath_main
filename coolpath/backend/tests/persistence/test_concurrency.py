import pytest
from datetime import datetime, timezone, timedelta
from app.db.models import DispatchMissionModel, WorkOrderModel, ThermalPolicyModel
from app.repositories.mission_repository import MissionRepository, VersionConflictError
from app.models.mission import DispatchMissionState, Coordinate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base

# Setup an in-memory SQLite for testing repositories
engine = create_engine("sqlite:///:memory:")
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)

def test_create_mission(db_session):
    repo = MissionRepository(db_session)
    state = DispatchMissionState(
        session_id="sess_1",
        mission_version=1,
        work_order_id="wo_1",
        task_type="repair",
        crew_id="crew_1",
        crew_location=Coordinate(lat=40.7, lng=-74.0),
        job_location=Coordinate(lat=40.71, lng=-74.01),
        estimated_outdoor_minutes=30,
        priority="NORMAL",
        sla_deadline=datetime.now(timezone.utc) + timedelta(hours=2),
        max_dispatch_delay_minutes=60,
        thermal_policy_id="pol_1",
        thermal_policy_version="v1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    repo.create_mission(state)
    db_session.commit()
    
    mission = repo.get_mission(state.session_id)
    assert mission is not None
    assert mission.work_order_id == "wo_1"
    assert mission.mission_version == 1

def test_optimistic_concurrency_success(db_session):
    repo = MissionRepository(db_session)
    state = DispatchMissionState(
        session_id="sess_1",
        mission_version=1,
        work_order_id="wo_2",
        task_type="repair",
        crew_id="crew_1",
        crew_location=Coordinate(lat=40.7, lng=-74.0),
        job_location=Coordinate(lat=40.71, lng=-74.01),
        estimated_outdoor_minutes=30,
        priority="NORMAL",
        sla_deadline=datetime.now(timezone.utc) + timedelta(hours=2),
        max_dispatch_delay_minutes=60,
        thermal_policy_id="pol_1",
        thermal_policy_version="v1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    repo.create_mission(state)
    db_session.commit()
    
    # Update with correct expected version
    updated_state = repo.update_mission_optimistic(state, expected_version=1)
    db_session.commit()
    
    assert updated_state.mission_version == 2
    
    mission = repo.get_mission(state.session_id)
    assert mission.mission_version == 2

def test_optimistic_concurrency_failure(db_session):
    repo = MissionRepository(db_session)
    state = DispatchMissionState(
        session_id="sess_1",
        mission_version=1,
        work_order_id="wo_3",
        task_type="repair",
        crew_id="crew_1",
        crew_location=Coordinate(lat=40.7, lng=-74.0),
        job_location=Coordinate(lat=40.71, lng=-74.01),
        estimated_outdoor_minutes=30,
        priority="NORMAL",
        sla_deadline=datetime.now(timezone.utc) + timedelta(hours=2),
        max_dispatch_delay_minutes=60,
        thermal_policy_id="pol_1",
        thermal_policy_version="v1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    repo.create_mission(state)
    db_session.commit()
    
    # Try updating with wrong expected version (e.g. 0)
    with pytest.raises(VersionConflictError):
        repo.update_mission_optimistic(state, expected_version=0)
