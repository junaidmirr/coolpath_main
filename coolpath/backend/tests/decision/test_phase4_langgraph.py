import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

from app.agent.state import CoolPathDispatchState, MissionPatch
from app.agent.graph import agent_executor
from app.models.mission import DispatchMissionState, Coordinate
from app.models.evidence import ThermalEvidence

def get_base_mission() -> DispatchMissionState:
    return DispatchMissionState(
        session_id="sess_123",
        mission_version=1,
        work_order_id="wo_456",
        task_type="repair",
        crew_id="crew_789",
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

def test_supersession_guard():
    # Setup initial state
    mission = get_base_mission()
    state = CoolPathDispatchState(
        request_id="req_1",
        mission_id="m_1",
        current_mission_version=2,  # Represents state in DB changed by another thread
        evaluation_version=1,       # We started evaluating when it was version 1
        mission_state=mission
    )
    
    # Run graph for this specific node
    from app.agent.nodes import supersession_guard_node
    result = supersession_guard_node(state)
    assert result["is_superseded"] is True
    
    events = result.get("pipeline_events", [])
    assert any(e.event_type == "DECISION_SUPERSEDED" for e in events)

@pytest.mark.anyio
async def test_hero_call_counts():
    """
    The hero test proving provider call counts on priority-only change.
    """
    mission = get_base_mission()
    
    # Initial run (simulating a fresh fetch)
    initial_state = {
        "request_id": "req_hero_1",
        "mission_id": "m_hero",
        "current_mission_version": 1,
        "evaluation_version": 1,
        "mission_state": mission,
        "mission_patch": MissionPatch(priority="NORMAL")
    }
    
    config = {"configurable": {"thread_id": "thread_hero"}}
    
    # Run the graph
    final_state_dict = await agent_executor.ainvoke(initial_state, config=config)
    
    events = final_state_dict.get("pipeline_events", [])
    
    # In initial run, we fetched thermal evidence and routes
    assert final_state_dict["needs_routing"] is True
    assert final_state_dict["needs_thermal"] is True
    
    # Now simulate the "This job is now an emergency" update
    # The dispatcher updates the priority, but location doesn't change.
    # We pass the same thread_id to reuse the graph state/checkpointer
    
    followup_state = {
        "request_id": "req_hero_2",
        "mission_id": "m_hero",
        "current_mission_version": 2, # Note: merge_state increments version to 2
        "evaluation_version": 2,
        "mission_patch": MissionPatch(priority="EMERGENCY")
    }
    
    # LangGraph automatically merges this with the existing state for thread_hero
    final_followup_dict = await agent_executor.ainvoke(followup_state, config=config)
    
    followup_events = final_followup_dict.get("pipeline_events", [])
    
    # Check that dirty fields detected priority change but NOT location change
    assert "priority_changed" in final_followup_dict["dirty_fields"]
    assert "location_changed" not in final_followup_dict["dirty_fields"]
    
    # Check flags
    assert final_followup_dict["needs_routing"] is False
    assert final_followup_dict["needs_thermal"] is False
    
    # Verify reuse events
    event_types = [e.event_type for e in followup_events]
    assert "ROUTES_REUSED" in event_types
    assert "REUSING_THERMAL_EVIDENCE" in event_types
    
    # Verify the mission state was updated properly
    assert final_followup_dict["mission_state"].priority == "EMERGENCY"
    assert final_followup_dict["current_mission_version"] == 3
    assert final_followup_dict["is_superseded"] is False
