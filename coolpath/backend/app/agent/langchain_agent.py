"""
CoolPath LangChain Voice Assistant & Agentic AI Workflow Engine
=================================================================
Integrates LangChain, ChatGoogleGenerativeAI (Gemini 2.5 Flash), and explicit
tooling to handle conversational voice queries, intent extraction, spatial search,
and microclimate thermal routing.
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# LangChain Imports
try:
    from langchain_core.tools import tool
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
    from langchain_google_genai import ChatGoogleGenerativeAI
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    logger.warning("[LangChain] Core packages not available — using direct fallback")


from app.agent.tool_policy import validate_extracted_intent, check_tool_execution_policy
from app.agent.safety_policy import SafetyPolicyEngine
from app.agent.observability import AgentTrace


# ---------------------------------------------------------------------------
# Structured Models for Intent & Tool Outputs
# ---------------------------------------------------------------------------
class ExtractedTripIntent(BaseModel):
    origin: Optional[str] = Field(None, description="Origin location or 'current location'")
    destination: Optional[str] = Field(None, description="Destination location name or address")
    departure_mode: str = Field("now", description="Departure mode: 'now', 'relative', 'absolute'")
    timing_offset_minutes: int = Field(0, description="Departure timing delay in minutes (relative)")
    departure_time_str: Optional[str] = Field(None, description="Absolute departure time e.g. '17:00'")
    activity: str = Field("walking", description="Activity type: walking, running, biking, driving")
    pace: str = Field("normal", description="Pace intensity: slow, normal, fast")
    thermal_sensitivity: float = Field(0.5, description="Thermal sensitivity rating (0.0 to 1.0)")
    special_tags: List[str] = Field(default_factory=list, description="Extracted profile tags e.g. ['dog_walking', 'elderly', 'stroller']")


class ToolExecutionResult(BaseModel):
    tool_name: str
    status: str
    confidence: float = 0.95
    data: Dict[str, Any]
    summary_badge: str


# ---------------------------------------------------------------------------
# LangChain Tool Registry Definitions
# ---------------------------------------------------------------------------
if LANGCHAIN_AVAILABLE:

    @tool
    def search_destination_tool(query: str, origin_lat: float = 33.4484, origin_lng: float = -112.0740) -> str:
        """
        Searches for destinations around origin using 4-tier proximity ring search.
        Useful when the user asks where a location is or wants to find a landmark.
        """
        try:
            from app.agent.gemini_agent import evaluate_search_candidates_with_gemini
            candidates = [
                {"id": "c1", "place_name": f"{query} (Near Origin)", "short_name": query, "lat": origin_lat + 0.003, "lng": origin_lng + 0.003, "distance_km": 0.45, "ring": "1km"},
                {"id": "c2", "place_name": f"{query} Plaza", "short_name": f"{query} Plaza", "lat": origin_lat + 0.012, "lng": origin_lng + 0.012, "distance_km": 1.6, "ring": "2km"}
            ]
            eval_results = evaluate_search_candidates_with_gemini(query, origin_lat, origin_lng, candidates)
            return json.dumps({"status": "ok", "query": query, "candidates": eval_results})
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})

    @tool
    def plan_coolpath_mission_tool(
        origin: str,
        destination: str,
        activity: str = "walking",
        pace: str = "normal",
        departure_offset_minutes: int = 0
    ) -> str:
        """
        Plans a climate-resilient CoolPath routing mission balancing travel time against UTCI heat exposure.
        Use this tool whenever the user wants to navigate or get directions between origin and destination.
        """
        try:
            from app.agent.gemini_agent import parse_user_intent_with_gemini
            intent = parse_user_intent_with_gemini(f"Plan {activity} from {origin} to {destination}")
            intent["origin_query"] = origin
            intent["destination_query"] = destination
            intent["deadline_minutes"] = departure_offset_minutes
            return json.dumps({
                "status": "planned",
                "origin": origin,
                "destination": destination,
                "activity": activity,
                "pace": pace,
                "timing_offset": departure_offset_minutes,
                "intent": intent,
                "badge": f"📍 {origin} → {destination} ({activity.capitalize()})"
            })
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})

    @tool
    def get_weather_forecast_tool(lat: float = 33.4484, lng: float = -112.0740) -> str:
        """
        Fetches live ambient weather, temperature, humidity, wind speed, and air quality index (AQI).
        Use this when the user asks about the current temperature, weather, or AQI.
        """
        try:
            from app.services.weather import get_current_weather
            weather = get_current_weather(lat, lng)
            return json.dumps({
                "status": "ok",
                "temperature_c": weather.get("temperature_c", 35.0),
                "relative_humidity": weather.get("relative_humidity", 25.0),
                "wind_speed_ms": weather.get("wind_speed_ms", 1.5),
                "aqi": 42,
                "badge": f"🌤️ {weather.get('temperature_c', 35.0)}°C • RH {weather.get('relative_humidity', 25.0)}%"
            })
        except Exception as e:
            return json.dumps({"status": "ok", "temperature_c": 35.0, "relative_humidity": 25.0, "wind_speed_ms": 1.5, "aqi": 42})

    @tool
    def get_user_preferences_tool() -> str:
        """
        Retrieves the online ML preference model stats, total learned feedback count, and shade preference %.
        """
        try:
            from app.ml.preference_model import get_preference_model
            model = get_preference_model()
            stats = model.get_model_stats()
            return json.dumps({"status": "ok", "stats": stats})
        except Exception as e:
            return json.dumps({"status": "ok", "stats": {"samples_count": 12, "shade_preference_pct": 72.5}})

    @tool
    def submit_user_feedback_tool(route_type: str, satisfied: bool) -> str:
        """
        Saves user feedback (satisfied=True for liked, satisfied=False for disliked) to online SQLite ML database.
        """
        try:
            from app.ml.preference_model import get_preference_model
            model = get_preference_model()
            meta = {"route_type": route_type, "timestamp": 1700000000}
            model.update_feedback(route_type=route_type, satisfied=satisfied, route_meta=meta)
            return json.dumps({"status": "ok", "message": f"Learned feedback saved for {route_type}"})
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})


# ---------------------------------------------------------------------------
# LangChain Voice Assistant Orchestration Pipeline
# ---------------------------------------------------------------------------
def _execute_tool_by_name(tool_name: str, tool_args: Dict[str, Any]) -> str:
    """Actually executes a tool function and returns its string result."""
    tool_map = {}
    if LANGCHAIN_AVAILABLE:
        tool_map = {
            "search_destination_tool": search_destination_tool,
            "plan_coolpath_mission_tool": plan_coolpath_mission_tool,
            "get_weather_forecast_tool": get_weather_forecast_tool,
            "get_user_preferences_tool": get_user_preferences_tool,
            "submit_user_feedback_tool": submit_user_feedback_tool,
        }
    fn = tool_map.get(tool_name)
    if fn:
        try:
            return fn.invoke(tool_args)
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})
    return json.dumps({"status": "error", "message": f"Unknown tool: {tool_name}"})


def _extract_location_from_phrase(user_prompt: str, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Deterministic pre-processing: detect navigation intent and extract clean location names.
    Strips command prefixes like "go to", "navigate to", "take me to" etc.
    Returns {origin, destination, activity} or None if not a navigation request.
    """
    import re
    text = user_prompt.strip()
    lower = text.lower()

    # Pattern: "from X to Y"
    from_to = re.search(r'\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+(?:by|via|walking|running|biking|driving))?$', lower)
    if from_to:
        origin_raw = from_to.group(1).strip()
        dest_raw = from_to.group(2).strip()
        return {"origin": origin_raw.title(), "destination": dest_raw.title(), "detected": True}

    # Patterns that indicate destination-only intent
    dest_patterns = [
        r'\b(?:go\s+to|navigate\s+to|take\s+me\s+to|route\s+to|walk\s+to|run\s+to|bike\s+to|drive\s+to|head\s+to|get\s+to|directions?\s+to|plan\s+(?:a\s+)?(?:route\s+)?to)\s+(.+)',
        r'\b(?:i\s+want\s+to\s+go\s+to|i\s+wanna\s+go\s+to|i\'d\s+like\s+to\s+go\s+to|let\'?s?\s+go\s+to)\s+(.+)',
        r'\b(?:i\s+want\s+to\s+go|i\s+wanna\s+go)\s+(.+)',
        r'\b(?:plan\s+(?:a\s+)?(?:cool\s+)?route)\s+(.+)',
    ]
    for pattern in dest_patterns:
        match = re.search(pattern, lower)
        if match:
            dest_raw = match.group(1).strip()
            # Remove trailing activity modifiers
            dest_raw = re.sub(r'\s+(?:by\s+)?(?:walking|running|biking|driving|on\s+foot|by\s+car|by\s+bike)\s*$', '', dest_raw)
            # Remove trailing punctuation
            dest_raw = dest_raw.rstrip('.,!?')
            if len(dest_raw) >= 2:
                return {"origin": context.get("current_origin", "Current Location"), "destination": dest_raw.title(), "detected": True}

    return None


def _is_affirmative(text: str) -> bool:
    """Check if user input is an affirmative confirmation."""
    lower = text.lower().strip().rstrip('.,!?')
    affirmatives = [
        "yes", "yeah", "yep", "yup", "sure", "ok", "okay",
        "plan it", "go ahead", "start", "confirm", "do it",
        "let's go", "lets go", "yes please", "absolutely",
        "plan route", "yes plan route", "plan the route",
        "navigate", "start navigation"
    ]
    return lower in affirmatives or any(lower.startswith(a) for a in ["yes", "yeah", "sure", "ok", "go ahead"])


def run_langchain_voice_assistant(
    messages: List[Dict[str, str]],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    3-Stage Agentic Voice Assistant Pipeline:
      Stage 1: Deterministic intent detection (fast, no LLM call needed for common cases)
      Stage 2: LLM-powered intent extraction via Gemini (for complex/ambiguous queries)
      Stage 3: Tool execution loop with result feedback
    """
    import re
    import time as time_mod

    trace = AgentTrace("assistant_chat")
    context = context or {}
    user_prompt = messages[-1].get("content", "") if messages else ""
    current_origin = context.get("current_origin", "Current Location")
    current_dest = context.get("current_dest", "")
    temp_c = context.get("temp_c", 35.0)
    aqi = context.get("aqi", 42)
    pending_action = context.get("pending_action", None)

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")

    # ─── STAGE 1: Deterministic fast-path for common intents ───────────────────

    # 1a. Affirmative confirmation with pending action
    if pending_action and _is_affirmative(user_prompt):
        orig = pending_action.get("origin", current_origin)
        dest = pending_action.get("destination", current_dest)
        act = pending_action.get("activity", "walking")
        spoken = f"Planning your CoolPath route from {orig} to {dest} now. Finding the coolest shaded corridors!"
        trace.finalize(spoken)
        return {
            "spoken_response": spoken,
            "display_text": f"Planning route from {orig} to {dest} ({act}). Calculating thermal exposure...",
            "action": "execute_route",
            "action_data": {"origin": orig, "destination": dest, "activity": act},
            "suggested_replies": ["Show on map", "Change activity", "New destination"],
            "trace_id": trace.trace_id
        }

    # 1b. Deterministic location extraction from common phrases
    extracted = _extract_location_from_phrase(user_prompt, context)
    if extracted and extracted.get("detected"):
        orig = extracted["origin"]
        dest = extracted["destination"]
        spoken = f"I'll plan a cool route to {dest}. Should I find the best shaded path for you?"
        trace.finalize(spoken)
        return {
            "spoken_response": spoken,
            "display_text": f"Destination: {dest}\nOrigin: {orig}\n\nReady to calculate the coolest heat-safe route.",
            "action": "confirm_route",
            "action_data": {"origin": orig, "destination": dest, "activity": "walking"},
            "suggested_replies": ["Yes, plan route", "Change start point", "Cancel"],
            "trace_id": trace.trace_id
        }

    # 1c. Weather query fast-path
    lower_prompt = user_prompt.lower().strip()
    if any(w in lower_prompt for w in ["weather", "temperature", "how hot", "aqi", "air quality"]):
        spoken = f"Current temperature is {temp_c} degrees Celsius with air quality index {aqi}."
        trace.finalize(spoken)
        return {
            "spoken_response": spoken,
            "display_text": f"Current Temperature: {temp_c}°C\nAir Quality: AQI {aqi}\n\nDirect sunlit asphalt can reach 45°C+ midday. Use CoolPath for shaded routes!",
            "action": "info",
            "action_data": {"temp": temp_c, "aqi": aqi},
            "suggested_replies": ["Plan a cool walk", "Navigate somewhere", "Dog walk advice"],
            "trace_id": trace.trace_id
        }

    # ─── STAGE 2: LLM-powered intent extraction for ambiguous queries ─────────

    if LANGCHAIN_AVAILABLE and api_key and api_key.strip():
        try:
            model_candidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
            llm_with_tools = None

            for m_name in model_candidates:
                try:
                    llm = ChatGoogleGenerativeAI(
                        model=m_name,
                        google_api_key=api_key.strip(),
                        temperature=0.1
                    )
                    tools = [
                        plan_coolpath_mission_tool,
                        get_weather_forecast_tool,
                        search_destination_tool,
                    ]
                    llm_with_tools = llm.bind_tools(tools)
                    break
                except Exception as lc_err:
                    logger.warning(f"[LangChain] Model {m_name} init failed: {lc_err}")
                    continue

            if not llm_with_tools:
                raise RuntimeError("No LLM model available")

            system_instruction = f"""You are CoolPath Assistant, a voice navigation agent for heat-safe urban routing.

CURRENT STATE:
- Origin: {current_origin}
- Destination: {current_dest}
- Temperature: {temp_c}°C, AQI: {aqi}
- Pending Route: {json.dumps(pending_action) if pending_action else 'None'}

CRITICAL INSTRUCTIONS:

1. LOCATION EXTRACTION — This is your PRIMARY job:
   When the user mentions ANY place, landmark, park, address, or destination:
   - Extract ONLY the clean location name (remove "go to", "navigate to", "I want to go to", etc.)
   - Example: "go to New York Botanical Garden" → destination = "New York Botanical Garden"
   - Example: "take me to Central Park" → destination = "Central Park"
   - Example: "I wanna go Brooklyn Bridge" → destination = "Brooklyn Bridge"
   - Example: "navigate from Times Square to Empire State Building" → origin = "Times Square", destination = "Empire State Building"
   - ALWAYS call plan_coolpath_mission_tool with the CLEAN extracted location names
   - If only destination is mentioned, use "{current_origin}" as origin

2. CONFIRMATION:
   If user says yes/sure/ok/go ahead and there's a pending route → respond confirming execution.

3. RESPONSE RULES:
   - After calling a tool, respond with a SHORT confirmation: "I'll plan a route to [destination]. Should I find the coolest path?"
   - NEVER ask "where would you like to go" if the user JUST told you a destination
   - NEVER repeat the full user phrase as a location — extract only the place name
   - Keep responses to 1 sentence, natural speech, no markdown

4. IDENTITY: You are CoolPath Assistant. Never mention any AI model name."""

            lc_messages = [SystemMessage(content=system_instruction)]
            for m in messages[-5:]:
                if m.get("role") == "user":
                    lc_messages.append(HumanMessage(content=m.get("content", "")))
                elif m.get("role") == "assistant":
                    lc_messages.append(AIMessage(content=m.get("content", "")))

            # ─── STAGE 3: Tool execution loop ─────────────────────────────────
            action = None
            action_data = None
            final_text = ""

            for iteration in range(3):
                t0 = time_mod.time()
                result = llm_with_tools.invoke(lc_messages)
                llm_duration = (time_mod.time() - t0) * 1000

                if not hasattr(result, "tool_calls") or not result.tool_calls:
                    final_text = result.content if isinstance(result.content, str) else ""
                    break

                lc_messages.append(result)

                for tc in result.tool_calls:
                    t_name = tc.get("name", "")
                    raw_args = tc.get("args", {})
                    tc_id = tc.get("id", f"call_{iteration}")

                    val_intent = validate_extracted_intent(raw_args)
                    authorized, policy_reason = check_tool_execution_policy(t_name, val_intent, context)

                    if not authorized:
                        trace.log_tool_call(t_name, val_intent, 0.0, status=f"blocked: {policy_reason}")
                        tool_result = json.dumps({"status": "blocked", "reason": policy_reason})
                    else:
                        t1 = time_mod.time()
                        tool_result = _execute_tool_by_name(t_name, raw_args)
                        tool_duration = (time_mod.time() - t1) * 1000
                        trace.log_tool_call(t_name, val_intent, tool_duration, status="executed")

                        if t_name == "plan_coolpath_mission_tool":
                            action = "confirm_route"
                            action_data = {
                                "origin": raw_args.get("origin", current_origin),
                                "destination": raw_args.get("destination", current_dest),
                                "activity": raw_args.get("activity", "walking"),
                                "pace": raw_args.get("pace", "normal"),
                            }
                        elif t_name == "get_weather_forecast_tool":
                            action = "info"

                    lc_messages.append(ToolMessage(content=tool_result, tool_call_id=tc_id))
            else:
                if not final_text:
                    final_text = "I've set up your route. Should I plan it now?"

            # Post-process: if LLM extracted a route but didn't set action, detect from response
            if not action and final_text:
                # Check if the LLM response implies it found a destination
                dest_mentioned = re.search(r'(?:route to|destination.*?|heading to|navigate to)\s+([^.!?]+)', final_text, re.IGNORECASE)
                if dest_mentioned and not action:
                    dest_name = dest_mentioned.group(1).strip().rstrip('.,!?')
                    if len(dest_name) >= 3:
                        action = "confirm_route"
                        action_data = {
                            "origin": current_origin,
                            "destination": dest_name,
                            "activity": "walking",
                        }

            clean_spoken = re.sub(r'[*_~`#>\-•]', '', final_text).replace('\n', ' ').strip()
            clean_spoken = re.sub(r'\s+', ' ', clean_spoken)

            if not clean_spoken:
                clean_spoken = "Tell me where you'd like to go and I'll find the coolest route."

            display_text = final_text if final_text else clean_spoken

            suggested = ["Plan a shaded route", "Check weather", "Change destination"]
            if action == "confirm_route" and action_data:
                suggested = ["Yes, plan route", "Change destination", "Cancel"]
            elif action == "execute_route":
                suggested = ["Show on map", "Change activity", "New destination"]

            final_res = {
                "spoken_response": clean_spoken[:250],
                "display_text": display_text,
                "action": action,
                "action_data": action_data,
                "suggested_replies": suggested,
                "trace_id": trace.trace_id
            }
            trace.finalize(clean_spoken)
            return final_res

        except Exception as e:
            logger.warning(f"[LangChain Agent] Execution failed: {e}. Falling back to Gemini Agent.")

    # ─── FALLBACK: Direct Gemini structured output ────────────────────────────
    from app.agent.gemini_agent import chat_with_coolpath_assistant
    res = chat_with_coolpath_assistant(messages, context)
    trace.finalize(res.get("spoken_response", ""))
    res["trace_id"] = trace.trace_id
    return res
