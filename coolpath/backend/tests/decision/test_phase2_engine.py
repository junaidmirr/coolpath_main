import pytest
from datetime import datetime, timedelta

from app.models.mission import DispatchMissionState, Coordinate
from app.models.policy import ThermalPolicy
from app.models.evidence import ThermalEvidence
from app.models.reason_codes import ReasonCode
from app.decision.generator import CandidateGenerator
from app.decision.thermal_capacity import ThermalCapacityAdapter
from app.decision.selector import DecisionSelector

def setup_fixtures(priority="NORMAL", sla_offset_mins=120):
    base_time = datetime(2026, 8, 29, 14, 0, 0)
    
    mission_state = DispatchMissionState(
        session_id="s1",
        work_order_id="w1",
        task_type="repair",
        crew_id="c1",
        crew_location=Coordinate(lat=40.7, lng=-74.0),
        job_location=Coordinate(lat=40.71, lng=-74.01),
        estimated_outdoor_minutes=45,
        priority=priority,
        sla_deadline=base_time + timedelta(minutes=sla_offset_mins),
        max_dispatch_delay_minutes=60,
        thermal_policy_id="p1",
        thermal_policy_version="v1",
        mission_version=2,
        created_at=base_time,
        updated_at=base_time
    )
    
    policy = ThermalPolicy(
        policy_id="p1",
        policy_version="v1",
        metric="TEMP_TIME_PROXY_C_MIN",
        threshold=38.0,
        max_continuous_outdoor_minutes=60
    )
    
    evidence = ThermalEvidence(
        evidence_id="ev_live_1",
        provider="fortyguard",
        requested_at=base_time,
        data_mode="LIVE",
        unit="TEMP_TIME_PROXY_C_MIN",
        freshness_seconds=60,
        freshness_status="FRESH"
    )
    
    return base_time, mission_state, policy, evidence

def run_engine(base_time, mission_state, policy, evidence, routes, time_offsets, current_route_id="route_A"):
    candidates = CandidateGenerator.generate_candidates(
        mission_state, routes, time_offsets, base_time, evidence.evidence_id
    )
    
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
        
    return DecisionSelector.select_decision(feasibilities, mission_state, base_time, current_route_id)

def test_1_dispatch_now():
    base_time, state, policy, ev = setup_fixtures()
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0, 15: 36.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0, 15])
    
    assert decision.action == "DISPATCH_NOW"
    assert decision.evidence_id == "ev_live_1"
    assert ReasonCode.SLA_MET in decision.reason_codes

def test_2_delay():
    base_time, state, policy, ev = setup_fixtures()
    routes = [
        # Immediate departure has higher exposure than +15 min
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 37.0, 15: 34.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0, 15])
    
    assert decision.action == "DELAY"
    assert "cand_route_A_15" == decision.candidate_id
    assert ReasonCode.WITHIN_ALLOWED_DELAY in decision.reason_codes
    assert ReasonCode.LOWER_CALCULATED_EXPOSURE in decision.reason_codes

def test_3_reroute():
    base_time, state, policy, ev = setup_fixtures()
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 37.0}},
        {"route_id": "route_B", "travel_minutes": 17, "calculated_exposure": {0: 33.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "REROUTE"
    assert "cand_route_B_0" == decision.candidate_id
    assert ReasonCode.ALTERNATE_ROUTE_SELECTED in decision.reason_codes

def test_4_escalate():
    base_time, state, policy, ev = setup_fixtures()
    # All routes exceed threshold 38
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 39.0, 15: 40.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0, 15])
    
    assert decision.action == "ESCALATE"
    assert decision.approval_required is True
    assert ReasonCode.NO_FEASIBLE_CANDIDATE in decision.reason_codes
    assert ReasonCode.NO_POLICY_COMPLIANT_PLAN in decision.reason_codes

def test_5_emergency_with_feasible_plan():
    base_time, state, policy, ev = setup_fixtures(priority="EMERGENCY")
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "DISPATCH_NOW"

def test_6_emergency_with_policy_conflict():
    base_time, state, policy, ev = setup_fixtures(priority="EMERGENCY")
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 39.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "ESCALATE"
    assert ReasonCode.PRIORITY_POLICY_CONFLICT in decision.reason_codes

def test_7_sla_violation():
    base_time, state, policy, ev = setup_fixtures(sla_offset_mins=30)
    # Travel 15 + outdoor 45 = 60 mins > 30 min SLA
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "ESCALATE"
    assert decision.candidate_id is None
    # SLA violation means it's not feasible
    
def test_8_evidence_reference():
    base_time, state, policy, ev = setup_fixtures()
    routes = [{"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    assert decision.evidence_id == "ev_live_1"

def test_9_determinism():
    base_time, state, policy, ev = setup_fixtures()
    routes = [
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0, 15: 35.0}}
    ]
    decision1 = run_engine(base_time, state, policy, ev, routes, [0, 15])
    decision2 = run_engine(base_time, state, policy, ev, routes, [0, 15])
    assert decision1.model_dump() == decision2.model_dump()

def test_10_replay():
    base_time, state, policy, ev = setup_fixtures()
    routes = [{"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    # Simulate a later replay with exactly the same snapshot
    decision_replay = run_engine(base_time, state, policy, ev, routes, [0])
    assert decision.candidate_id == decision_replay.candidate_id
    assert decision.action == decision_replay.action
    assert decision.reason_codes == decision_replay.reason_codes

def test_11_stable_tie_break():
    base_time, state, policy, ev = setup_fixtures()
    # Route A and Route B are completely identical in exposure and time
    routes = [
        {"route_id": "route_B", "travel_minutes": 15, "calculated_exposure": {0: 35.0}},
        {"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}
    ]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    # Based on lexicographic tie break in rank_key: cand_route_A_0 < cand_route_B_0
    assert decision.candidate_id == "cand_route_A_0"
    
def test_12_mission_version():
    base_time, state, policy, ev = setup_fixtures()
    routes = [{"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    assert decision.mission_version == 2

def test_13_metric_mismatch():
    base_time, state, policy, ev = setup_fixtures()
    policy.metric = "TEMP_TIME_PROXY_C_MIN"
    # Provide candidate with wrong unit
    routes = [{"route_id": "route_A", "travel_minutes": 15, "unit": "TEMPERATURE_C", "calculated_exposure": {0: 35.0}}]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "ESCALATE"
    assert ReasonCode.NO_POLICY_COMPLIANT_PLAN in decision.reason_codes

def test_14_degraded_evidence():
    base_time, state, policy, ev = setup_fixtures()
    ev.data_mode = "DEGRADED"
    routes = [{"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}]
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    
    assert decision.action == "ESCALATE"
    assert ReasonCode.NO_POLICY_COMPLIANT_PLAN in decision.reason_codes

def test_15_expired_evidence():
    base_time, state, policy, ev = setup_fixtures()
    ev.freshness_status = "EXPIRED"
    routes = [{"route_id": "route_A", "travel_minutes": 15, "calculated_exposure": {0: 35.0}}]
    
    # Check adapter output directly
    candidates = CandidateGenerator.generate_candidates(
        state, routes, [0], base_time, ev.evidence_id
    )
    c = candidates[0]
    feasibility = ThermalCapacityAdapter.evaluate_candidate(
        candidate_id=c.candidate_id,
        route_id=c.route_id,
        departure_at=c.departure_at,
        departure_offset_minutes=c.departure_offset_minutes,
        travel_minutes=c.travel_minutes,
        outdoor_minutes=c.outdoor_minutes,
        sla_deadline=state.sla_deadline,
        priority=state.priority,
        thermal_policy=policy,
        thermal_evidence=ev,
        calculated_exposure=c.calculated_thermal_exposure,
        unit=c.unit
    )
    
    assert feasibility.thermal_policy_met is None
    assert any("NOT_EVALUATED" in w for w in feasibility.warnings)
    assert not any("EXPIRED_EVIDENCE" in v for v in feasibility.violations)
    
    # Engine output should still be ESCALATE due to lack of feasible plan
    decision = run_engine(base_time, state, policy, ev, routes, [0])
    assert decision.action == "ESCALATE"
    assert ReasonCode.REQUIRED_THERMAL_EVIDENCE_UNAVAILABLE in decision.reason_codes
