import pytest
from datetime import datetime, timedelta
from app.models.policy import ThermalPolicy
from app.models.evidence import ThermalEvidence
from app.decision.thermal_capacity import ThermalCapacityAdapter

def test_thermal_capacity_adapter_feasible():
    policy = ThermalPolicy(
        policy_id="test-1",
        policy_version="1.0",
        metric="utci",
        threshold=38.0,
        max_continuous_outdoor_minutes=60
    )
    
    evidence = ThermalEvidence(
        evidence_id="ev-1",
        provider="fortyguard",
        requested_at=datetime.now(),
        data_mode="CACHED",
        unit="C",
        freshness_seconds=10
    )
    
    now = datetime.now()
    sla = now + timedelta(hours=2)
    
    feasibility = ThermalCapacityAdapter.evaluate_candidate(
        candidate_id="c-1",
        departure_at=now,
        travel_minutes=15.0,
        outdoor_minutes=45.0,
        sla_deadline=sla,
        priority="NORMAL",
        thermal_policy=policy,
        thermal_evidence=evidence,
        calculated_exposure=35.0
    )
    
    assert feasibility.feasible is True
    assert feasibility.sla_met is True
    assert feasibility.thermal_policy_met is True
    assert not feasibility.violations

def test_thermal_capacity_adapter_exceeds_threshold():
    policy = ThermalPolicy(
        policy_id="test-1",
        policy_version="1.0",
        metric="utci",
        threshold=38.0,
        max_continuous_outdoor_minutes=60
    )
    
    evidence = ThermalEvidence(
        evidence_id="ev-1",
        provider="fortyguard",
        requested_at=datetime.now(),
        data_mode="CACHED",
        unit="C",
        freshness_seconds=10
    )
    
    now = datetime.now()
    sla = now + timedelta(hours=2)
    
    feasibility = ThermalCapacityAdapter.evaluate_candidate(
        candidate_id="c-1",
        departure_at=now,
        travel_minutes=15.0,
        outdoor_minutes=45.0,
        sla_deadline=sla,
        priority="NORMAL",
        thermal_policy=policy,
        thermal_evidence=evidence,
        calculated_exposure=40.0
    )
    
    assert feasibility.feasible is False
    assert feasibility.sla_met is True
    assert feasibility.thermal_policy_met is False
    assert any("exceeds policy threshold" in v for v in feasibility.violations)

def test_thermal_capacity_adapter_misses_sla():
    policy = ThermalPolicy(
        policy_id="test-1",
        policy_version="1.0",
        metric="utci",
        threshold=38.0,
        max_continuous_outdoor_minutes=60
    )
    
    evidence = ThermalEvidence(
        evidence_id="ev-1",
        provider="fortyguard",
        requested_at=datetime.now(),
        data_mode="CACHED",
        unit="C",
        freshness_seconds=10
    )
    
    now = datetime.now()
    sla = now + timedelta(minutes=50) # Very tight SLA
    
    feasibility = ThermalCapacityAdapter.evaluate_candidate(
        candidate_id="c-1",
        departure_at=now,
        travel_minutes=15.0,
        outdoor_minutes=45.0,  # 15+45 = 60 mins > 50 min SLA
        sla_deadline=sla,
        priority="NORMAL",
        thermal_policy=policy,
        thermal_evidence=evidence,
        calculated_exposure=35.0
    )
    
    assert feasibility.feasible is False
    assert feasibility.sla_met is False
    assert feasibility.thermal_policy_met is True
    assert any("exceeds SLA deadline" in v for v in feasibility.violations)
