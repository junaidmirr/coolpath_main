import pytest
from datetime import datetime, timezone, timedelta
import asyncio
import sys
from unittest.mock import patch, MagicMock

# Mock heavy dependencies missing in this lightweight test environment
sys.modules['shapely'] = MagicMock()
sys.modules['shapely.geometry'] = MagicMock()
sys.modules['shapely.strtree'] = MagicMock()

from app.services.providers import (
    MockWorkOrderProvider,
    FortyGuardThermalProviderAdapter,
    OSMnxRoutingProviderAdapter
)
from app.models.mission import DispatchMissionState, Coordinate
from app.models.policy import ThermalPolicy
from app.decision.generator import CandidateGenerator
from app.decision.thermal_capacity import ThermalCapacityAdapter
from app.decision.selector import DecisionSelector

# Mock routing internally
import app.services.providers as providers_module
providers_module.compute_real_street_candidate_routes = MagicMock(return_value=[
    {
        "id": "r1",
        "duration": 900.0,
        "thermal_cost": 3.0,
        "avg_temp_c": 36.0,
        "geometry": []
    }
])

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_end_to_end_decision():
    base_time = datetime(2026, 8, 29, 14, 0, 0, tzinfo=timezone.utc)
    
    # 1. Fetch work order
    wo_provider = MockWorkOrderProvider()
    wo_data = await wo_provider.get_work_order("wo_test_1")
    crew_data = await wo_provider.get_crew_context("crew_1")
    
    mission_state = DispatchMissionState(
        session_id="s1",
        work_order_id=wo_data["work_order_id"],
        task_type=wo_data["task_type"],
        crew_id=crew_data["crew_id"],
        crew_location=Coordinate(**crew_data["crew_location"]),
        job_location=Coordinate(**wo_data["job_location"]),
        estimated_outdoor_minutes=float(wo_data["estimated_outdoor_minutes"]),
        priority=wo_data["priority"],
        sla_deadline=datetime.fromisoformat(wo_data["sla_deadline_iso"]),
        max_dispatch_delay_minutes=60,
        thermal_policy_id=crew_data["thermal_policy_id"],
        thermal_policy_version=crew_data["thermal_policy_version"],
        mission_version=1,
        created_at=base_time,
        updated_at=base_time
    )
    
    # 2. Fetch thermal evidence
    thermal_provider = FortyGuardThermalProviderAdapter()
    
    # Mock fortyguard underlying response to avoid actual API calls
    async def mock_prepare(*args, **kwargs):
        pass
        
    def mock_summary():
        return {"data_source": "microclimate_model"}
        
    with patch.object(thermal_provider.underlying, 'prepare_environment', new=mock_prepare):
        with patch.object(thermal_provider.underlying, 'get_environmental_summary', new=mock_summary):
            evidence = await thermal_provider.get_thermal_context(
                mission_state.job_location.lat,
                mission_state.job_location.lng,
                100,
                base_time
            )
            
    # 3. Fetch routes
    routing_provider = OSMnxRoutingProviderAdapter(thermal_provider)
    time_offsets = [0, 15, 30]
    routes = await routing_provider.get_routes(
        {"lat": mission_state.crew_location.lat, "lng": mission_state.crew_location.lng},
        {"lat": mission_state.job_location.lat, "lng": mission_state.job_location.lng},
        time_offsets,
        evidence
    )
    
    # 4. Generate candidates
    # Mocking policy
    policy = ThermalPolicy(
        policy_id="p1",
        policy_version="v1",
        metric="TEMP_TIME_PROXY_C_MIN",
        threshold=1000.0,
        max_continuous_outdoor_minutes=60
    )
    
    routes_dicts = [vars(r) for r in routes]
    candidates = CandidateGenerator.generate_candidates(
        mission_state, routes_dicts, time_offsets, base_time, evidence.evidence_id
    )
    
    # 5. Evaluate constraint feasibilities
    feasibilities = []
    for c in candidates:
        f = ThermalCapacityAdapter.evaluate_candidate(
            candidate_id=c.candidate_id,
            route_id=c.route_id,
            departure_at=c.departure_at,
            departure_offset_minutes=c.departure_offset_minutes,
            travel_minutes=c.travel_minutes,
            outdoor_minutes=c.outdoor_minutes,
            sla_deadline=mission_state.sla_deadline,
            priority=mission_state.priority,
            thermal_policy=policy,
            thermal_evidence=evidence,
            calculated_exposure=c.calculated_thermal_exposure,
            unit=c.unit
        )
        feasibilities.append(f)
        
    # 6. Make decision
    decision = DecisionSelector.select_decision(feasibilities, mission_state, base_time, "r1")
    
    # Since it's microclimate, evidence mode is DEGRADED. So it should escalate.
    assert decision.action == "ESCALATE"
