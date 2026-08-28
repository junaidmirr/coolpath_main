"""
Phase 10 Agentic Policy, Safety, and Observability Verification Tests
========================================================================

T10.1 Intent Validation (clamping thermal sensitivity, activity, departure_mode)
T10.2 Tool Execution Policy Gate (blocking unvalidated calls)
T10.3 Safety & Medical Policy Engine (deterministic safety guidance)
T10.4 Observability Agent Trace (trace_id and latency logging)
T10.5 Candidate Safety Policy Pre-Optimizer Filter (allowed, flagged, vetoed statuses)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from app.agent.tool_policy import validate_extracted_intent, check_tool_execution_policy
from app.agent.safety_policy import SafetyPolicyEngine
from app.agent.observability import AgentTrace


def test_t101_intent_validation():
    """Verify thermal sensitivity clamping, valid activity, and departure_mode."""
    raw = {
        "activity": "SUPER_FAST_RUN",
        "pace": "ULTRA",
        "thermal_sensitivity": 2.5,
        "timing_offset_minutes": 15
    }
    validated = validate_extracted_intent(raw)
    assert validated["activity"] == "walking"  # Fallback for invalid activity
    assert validated["pace"] == "normal"       # Fallback for invalid pace
    assert validated["thermal_sensitivity"] == 1.0  # Clamped to max 1.0
    assert validated["departure_mode"] == "relative"
    assert validated["departure_offset_minutes"] == 15
    print("✅ T10.1 PASSED — Intent validation and departure mode handling verified")


def test_t102_tool_policy_gate():
    """Verify tool policy authorizes valid calls and blocks missing params."""
    # Read-only search tool is safe
    auth, reason = check_tool_execution_policy("search_destination_tool", {}, {})
    assert auth is True

    # Mission planning tool without origin/dest is blocked
    auth_bad, reason_bad = check_tool_execution_policy("plan_coolpath_mission_tool", {}, {})
    assert auth_bad is False
    assert "Policy Gate Error" in reason_bad

    # Mission planning tool with origin/dest is authorized
    auth_good, reason_good = check_tool_execution_policy(
        "plan_coolpath_mission_tool",
        {"origin": "Phoenix Convention Center", "destination": "Heritage Square"},
        {}
    )
    assert auth_good is True
    print("✅ T10.2 PASSED — Tool policy gates enforced")


def test_t103_safety_policy_engine():
    """Verify deterministic safety rules for pet paw protection and running hyperthermia."""
    dog_guidance = SafetyPolicyEngine.get_approved_safety_guidance(
        activity="walking",
        special_profile_tags=["dog_walking"],
        avg_temp_c=36.0,
        avg_utci_c=38.0
    )
    assert "Pavement Heat Warning" in dog_guidance["health_alert"]

    runner_guidance = SafetyPolicyEngine.get_approved_safety_guidance(
        activity="running",
        special_profile_tags=[],
        avg_temp_c=34.0,
        avg_utci_c=36.0
    )
    assert "Running Intensity Alert" in runner_guidance["health_alert"]
    print("✅ T10.3 PASSED — Safety & medical policy engine rules verified")


def test_t104_agent_trace():
    """Verify AgentTrace creates trace IDs and logs tool durations."""
    trace = AgentTrace("unit_test")
    trace.log_tool_call("plan_coolpath_mission_tool", {"origin": "A", "destination": "B"}, 45.2)
    summary = trace.finalize("Test response")
    assert summary["trace_id"].startswith("tr_")
    assert summary["tool_calls_count"] == 1
    assert "total_ms" in summary["latencies_ms"]
    print(f"✅ T10.4 PASSED — Agent trace observability logged (Trace ID: {summary['trace_id']})")


def test_t105_candidate_safety_filtering():
    """Verify Pre-Optimizer Safety Filter explicitly assigns allowed, flagged, and vetoed statuses."""
    candidates = [
        {"id": "r1", "name": "Direct Unshaded Asphalt", "avg_temp_c": 37.0, "max_utci_c": 48.0, "shade_ratio": 0.05},
        {"id": "r2", "name": "Shaded Corridor", "avg_temp_c": 31.0, "max_utci_c": 34.0, "shade_ratio": 0.65},
        {"id": "r3", "name": "High UTCI Route", "avg_temp_c": 33.0, "max_utci_c": 39.0, "shade_ratio": 0.40}
    ]
    safe, flagged = SafetyPolicyEngine.filter_and_flag_unsafe_candidates(
        candidates,
        activity="walking",
        special_profile_tags=["dog_walking"]
    )
    
    # r1 should be vetoed due to extreme heat & pet paw surface temp
    r1_eval = SafetyPolicyEngine.evaluate_candidate_safety(candidates[0], "walking", ["dog_walking"])
    assert r1_eval["status"] == "vetoed"

    # r2 should be allowed
    r2_eval = SafetyPolicyEngine.evaluate_candidate_safety(candidates[1], "walking", ["dog_walking"])
    assert r2_eval["status"] == "allowed"

    # r3 should be flagged (retained with advisory warning)
    r3_eval = SafetyPolicyEngine.evaluate_candidate_safety(candidates[2], "walking", ["dog_walking"])
    assert r3_eval["status"] == "flagged"

    assert len(safe) == 2  # r2 (allowed) + r3 (flagged) retained for optimizer
    assert len(flagged) == 1  # r1 vetoed and removed
    print("✅ T10.5 PASSED — Pre-optimizer candidate safety filtering (allowed, flagged, vetoed) verified")


if __name__ == "__main__":
    test_t101_intent_validation()
    test_t102_tool_policy_gate()
    test_t103_safety_policy_engine()
    test_t104_agent_trace()
    test_t105_candidate_safety_filtering()
    print("\n✅ All Phase 10 Agentic Policy Verification Tests PASSED")
