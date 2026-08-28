"""
Phase 7 Tests — Gemini Agent Tool Definitions & Numeric Grounding Guardrail
=============================================================================

T7.1  Tool definitions registry exists and contains expected 7 functions
T7.2  Numeric grounding guardrail catches and corrects hallucinated percentages
T7.3  Briefing generator returns grounded narrative matching mission facts
T7.4  Graceful fallback when Gemini API key is missing
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from app.agent.gemini_agent import (
    AGENT_TOOL_DEFINITIONS,
    verify_numeric_grounding,
    generate_gemini_briefing,
    parse_user_intent_with_gemini
)


# ---------------------------------------------------------------------------
# T7.1  Tool registry contains all 7 explicit functions
# ---------------------------------------------------------------------------
def test_t71_tool_registry():
    expected_names = {
        "get_weather", "get_heatmap", "get_route_candidates",
        "calculate_thermal_exposure", "compare_routes",
        "get_user_preferences", "save_preference"
    }
    registered = {tool["name"] for tool in AGENT_TOOL_DEFINITIONS}
    assert expected_names.issubset(registered), f"Missing tools: {expected_names - registered}"
    print(f"✅ T7.1 PASSED — all {len(registered)} tools defined in registry")


# ---------------------------------------------------------------------------
# T7.2  Numeric grounding guardrail corrects hallucinated numbers
# ---------------------------------------------------------------------------
def test_t72_numeric_grounding_guardrail():
    mission_facts = {
        "thermal_reduction_percent": 14.5,
        "best_route": {"avg_temp_c": 33.2, "avg_utci_c": 37.0}
    }

    # Stated 45.0% when computed is 14.5% → should be corrected to 14.5%
    hallucinated_text = "The route saves 45% heat exposure by avoiding asphalt."
    corrected = verify_numeric_grounding(hallucinated_text, mission_facts)
    assert "14.5%" in corrected, f"Guardrail failed to correct %: {corrected}"
    assert "45%" not in corrected, f"Hallucinated 45% remains in: {corrected}"

    # Matching text should be left intact
    matching_text = "The route saves 14.5% heat exposure."
    same = verify_numeric_grounding(matching_text, mission_facts)
    assert "14.5%" in same

    print("✅ T7.2 PASSED — numeric guardrail corrected 45% → 14.5%")


# ---------------------------------------------------------------------------
# T7.3  Briefing generator produces grounded briefing
# ---------------------------------------------------------------------------
def test_t73_briefing_grounding():
    mission_facts = {
        "activity": "walking",
        "thermal_reduction_percent": 18.2,
        "wait_minutes": 0,
        "special_profile_tags": ["dog_walking"],
        "best_route": {"avg_temp_c": 31.4, "avg_utci_c": 35.0}
    }
    briefing = generate_gemini_briefing(mission_facts)
    assert "headline" in briefing
    assert "narrative" in briefing
    assert "health_alert" in briefing
    # Verified: reduction number in narrative matches computed fact within tolerance
    assert ("18.2%" in briefing["narrative"] or "18.2%" in briefing["headline"] or
            "18%" in briefing["narrative"] or "18%" in briefing["headline"])
    print("✅ T7.3 PASSED — briefing grounded with exact computed facts")


# ---------------------------------------------------------------------------
# T7.4  Graceful fallback when Gemini API key is missing
# ---------------------------------------------------------------------------
def test_t74_graceful_fallback():
    # Calling parse_user_intent_with_gemini without API key returns rule-based dict
    intent = parse_user_intent_with_gemini("Walking with my puppy in extreme heat")
    assert intent["activity"] == "walking"
    assert "dog_walking" in intent["special_profile_tags"]
    assert intent["thermal_sensitivity"] >= 0.8
    print("✅ T7.4 PASSED — intent parsing fallback works cleanly")


if __name__ == "__main__":
    print("Running Phase 7 Tests...\n")
    test_t71_tool_registry()
    test_t72_numeric_grounding_guardrail()
    test_t73_briefing_grounding()
    test_t74_graceful_fallback()
    print("\n✅ All Phase 7 Tests PASSED")
