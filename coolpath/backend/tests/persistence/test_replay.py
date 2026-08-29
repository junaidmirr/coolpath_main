import pytest
from app.db.models import DecisionEventModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base
from app.repositories.decision_repository import DecisionRepository

engine = create_engine("sqlite:///:memory:")
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)

def test_replay_events(db_session):
    repo = DecisionRepository(db_session)
    
    repo.append_decision_event(
        event_type="MISSION_CREATED",
        mission_id="m_2",
        mission_version=1
    )
    repo.append_decision_event(
        event_type="THERMAL_EVIDENCE_FETCHED",
        mission_id="m_2",
        mission_version=1,
        evidence_id="ev_1"
    )
    repo.append_decision_event(
        event_type="DECISION_SELECTED",
        mission_id="m_2",
        mission_version=1,
        payload={"action": "DELAY"}
    )
    db_session.commit()
    
    events = db_session.query(DecisionEventModel).filter_by(mission_id="m_2").order_by(DecisionEventModel.created_at).all()
    assert len(events) == 3
    assert events[0].event_type == "MISSION_CREATED"
    assert events[1].event_type == "THERMAL_EVIDENCE_FETCHED"
    assert events[2].event_type == "DECISION_SELECTED"
