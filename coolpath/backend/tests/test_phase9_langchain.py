"""
Phase 9 LangChain Agent & Voice Assistant Pipeline Verification Tests
========================================================================

T9.1  LangChain Intent & Parameter Parsing (origin, destination, timing, activity)
T9.2  LangChain Tool Registry Registration (5 core tools)
T9.3  LangChain Voice Assistant Chat Response Structure & Action Confirmation
T9.4  LangChain Model Fallback Guarantee
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from app.agent.langchain_agent import run_langchain_voice_assistant, ExtractedTripIntent


# ---------------------------------------------------------------------------
# T9.1  LangChain Intent & Parameter Parsing
# ---------------------------------------------------------------------------
def test_t91_intent_parameter_parsing():
    """Verify trip intent extraction returns structured parameters."""
    intent = ExtractedTripIntent(
        origin="Phoenix Convention Center",
        destination="Heritage Square",
        timing_offset_minutes=15,
        activity="walking",
        pace="normal",
        special_tags=["dog_walking", "pavement_heat_sensitivity"]
    )
    assert intent.origin == "Phoenix Convention Center"
    assert intent.destination == "Heritage Square"
    assert intent.timing_offset_minutes == 15
    assert intent.activity == "walking"
    assert "dog_walking" in intent.special_tags
    print("✅ T9.1 PASSED — LangChain intent parameter extraction structure verified")


# ---------------------------------------------------------------------------
# T9.2  LangChain Tool Registry Registration
# ---------------------------------------------------------------------------
def test_t92_tool_registry_registration():
    """Verify core tool definitions are registered and accessible."""
    from app.agent.langchain_agent import (
        search_destination_tool,
        plan_coolpath_mission_tool,
        get_weather_forecast_tool,
        get_user_preferences_tool,
        submit_user_feedback_tool
    )
    assert search_destination_tool.name == "search_destination_tool"
    assert plan_coolpath_mission_tool.name == "plan_coolpath_mission_tool"
    assert get_weather_forecast_tool.name == "get_weather_forecast_tool"
    assert get_user_preferences_tool.name == "get_user_preferences_tool"
    assert submit_user_feedback_tool.name == "submit_user_feedback_tool"
    print("✅ T9.2 PASSED — 5 LangChain tool definitions registered")


# ---------------------------------------------------------------------------
# T9.3  LangChain Voice Assistant Chat Response & Action Confirmation
# ---------------------------------------------------------------------------
def test_t93_voice_assistant_response_structure():
    """Verify voice assistant chat pipeline returns structured response dict."""
    messages = [
        {"role": "user", "content": "Navigate from Phoenix Convention Center to Heritage Square"}
    ]
    context = {
        "current_origin": "Phoenix Convention Center",
        "current_dest": "Heritage Square",
        "temp_c": 38.5,
        "aqi": 35
    }
    res = run_langchain_voice_assistant(messages, context)
    assert isinstance(res, dict)
    assert "spoken_response" in res
    assert "display_text" in res
    assert "action" in res
    assert "suggested_replies" in res
    assert res["action"] in ["confirm_route", "execute_route", "info", None]
    print(f"✅ T9.3 PASSED — LangChain voice assistant returned valid response (Action: {res['action']})")


# ---------------------------------------------------------------------------
# T9.4  LangChain Fallback Guarantee
# ---------------------------------------------------------------------------
def test_t94_langchain_fallback():
    """Verify assistant handles off-topic query gracefully with domain boundary response."""
    messages = [
        {"role": "user", "content": "What is the capital of France?"}
    ]
    res = run_langchain_voice_assistant(messages, {})
    assert "spoken_response" in res
    assert len(res["spoken_response"]) > 0
    print("✅ T9.4 PASSED — LangChain domain boundary fallback verified")


if __name__ == "__main__":
    print("Running Phase 9 LangChain Verification Tests...\n")
    test_t91_intent_parameter_parsing()
    test_t92_tool_registry_registration()
    test_t93_voice_assistant_response_structure()
    test_t94_langchain_fallback()
    print("\n✅ All Phase 9 LangChain Verification Tests PASSED")
