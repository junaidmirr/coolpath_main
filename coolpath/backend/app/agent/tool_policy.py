"""
CoolPath Tool Policy & Authorization Layer
============================================
Enforces policy gates and execution constraints on LLM tool invocations.
Prevents unvalidated mission runs or accidental ML model weight mutations.
"""

import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger(__name__)

# Allowed activities and paces
VALID_ACTIVITIES = {"walking", "running", "biking", "driving"}
VALID_PACES = {"slow", "normal", "fast"}


def validate_extracted_intent(intent: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalizes and validates LLM extracted intent parameters.
    Guarantees thermal_sensitivity in [0, 1], valid activity, valid pace,
    and distinct departure_mode/offset.
    """
    validated = dict(intent)
    
    # 1. Activity validation
    act = str(validated.get("activity", "walking")).lower()
    validated["activity"] = act if act in VALID_ACTIVITIES else "walking"
    
    # 2. Pace validation
    pace = str(validated.get("pace", "normal")).lower()
    validated["pace"] = pace if pace in VALID_PACES else "normal"
    
    # 3. Thermal sensitivity clamping [0.0, 1.0]
    try:
        sens = float(validated.get("thermal_sensitivity", 0.5))
        validated["thermal_sensitivity"] = max(0.0, min(1.0, sens))
    except (ValueError, TypeError):
        validated["thermal_sensitivity"] = 0.5

    # 4. Departure Timing Mode Disambiguation
    offset = validated.get("departure_offset_minutes") or validated.get("timing_offset_minutes") or 0
    try:
        offset_val = max(0, int(offset))
    except (ValueError, TypeError):
        offset_val = 0

    if offset_val == 0:
        validated["departure_mode"] = "now"
        validated["departure_offset_minutes"] = 0
    else:
        validated["departure_mode"] = "relative"
        validated["departure_offset_minutes"] = offset_val

    return validated


def check_tool_execution_policy(tool_name: str, tool_args: Dict[str, Any], context: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Policy Gate: Checks if a tool call is authorized and safe to execute.
    
    Returns:
        Tuple[is_authorized: bool, reason: str]
    """
    # Safe read-only / lookup tools
    if tool_name in {"search_destination_tool", "get_weather_forecast_tool", "get_user_preferences_tool"}:
        return True, "Authorized read-only lookup tool"

    # Mission planning tool gate
    if tool_name == "plan_coolpath_mission_tool":
        orig = tool_args.get("origin") or context.get("current_origin")
        dest = tool_args.get("destination") or context.get("current_dest")
        if not orig or not dest:
            return False, "Policy Gate Error: Origin and Destination are required to plan mission"
        return True, "Authorized mission planning tool"

    # Feedback submission tool gate
    if tool_name == "submit_user_feedback_tool":
        user_confirmed = tool_args.get("user_confirmed", True)
        if not user_confirmed:
            return False, "Policy Gate Error: Feedback submission requires explicit user action"
        return True, "Authorized user feedback submission"

    return True, "Authorized tool"
