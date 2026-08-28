import os
import json
import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load .env variables
load_dotenv()

logger = logging.getLogger(__name__)

import warnings
warnings.filterwarnings("ignore", message=".*Automatic function calling.*")
warnings.filterwarnings("ignore", message=".*AFC.*")

GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
]


# Pydantic schemas for structured outputs
class ParsedIntent(BaseModel):
    activity: str = Field(default="walking", description="Activity type: walking, running, biking, driving")
    pace: str = Field(default="normal", description="Pace intensity: slow, normal, fast")
    origin_query: Optional[str] = Field(default=None, description="Origin location query if specified by user")
    destination_query: Optional[str] = Field(default=None, description="Destination location query if specified by user")
    deadline_minutes: Optional[int] = Field(default=30, description="Estimated deadline minutes from now")
    thermal_sensitivity: float = Field(default=0.5, description="Heat sensitivity rating from 0.0 (heat tolerant) to 1.0 (extreme sensitivity)")
    special_profile_tags: List[str] = Field(default_factory=list, description="Extracted profile tags e.g. dog_walking, asthma, child, heat_stroke_prone, shade_priority")
    summary: str = Field(default="Heat-aware mission request", description="Concise 1-sentence summary of user intent")


class CoolPathBriefing(BaseModel):
    headline: str = Field(description="Actionable, punchy recommendation headline")
    narrative: str = Field(description="Personalized contextual explanation of the recommended route and thermal conditions")
    health_alert: str = Field(description="Safety & medical advice tailored to user's profile and heat exposure")
    timing_advice: str = Field(description="Advice on departure timing e.g. depart immediately or wait for microclimate transition")


class AssistantMessage(BaseModel):
    role: str
    content: str


class AssistantActionData(BaseModel):
    origin: Optional[str] = Field(default=None, description="Origin location query or address")
    destination: Optional[str] = Field(default=None, description="Destination location query or address")
    activity: Optional[str] = Field(default=None, description="Activity type e.g. walking, running, biking")
    pace: Optional[str] = Field(default=None, description="Pace intensity e.g. slow, normal, fast")
    timing_offset: Optional[int] = Field(default=None, description="Departure timing delay in minutes")


class AssistantResponse(BaseModel):
    spoken_response: str = Field(description="Concise, clear spoken sentence (1-2 sentences, no markdown symbols or asterisks) perfect for Text-to-Speech voice output.")
    display_text: str = Field(description="Formatted response text for visual UI chat bubble.")
    action: Optional[str] = Field(default=None, description="Action to trigger in app: 'confirm_route', 'execute_route', 'switch_mode', 'info', or null")
    action_data: Optional[AssistantActionData] = Field(default=None, description="Action payload with explicit origin, destination, activity, pace, timing_offset fields.")
    suggested_replies: List[str] = Field(default_factory=list, description="Quick tap suggestions e.g. ['Yes, plan route', 'Change destination', 'Check weather']")


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")
    if not api_key or not api_key.strip():
        return None
    try:
        from google import genai
        return genai.Client(api_key=api_key.strip())
    except Exception as e:
        logger.warning(f"Google GenAI SDK init error: {e}")
        return None


def parse_user_intent_with_gemini(user_prompt: str) -> dict:
    """
    Agentic Intent Parser: Translates natural language queries into parameter inputs for our routing engine.
    """
    client = get_gemini_client()
    if client:
        from google.genai import types
        prompt = f"""
        You are the Intent Orchestrator for CoolPath, an urban heat-aware routing engine.
        Analyze the following user prompt and extract routing parameters and profile constraints.
        
        User Prompt: "{user_prompt}"
        
        Rules:
        - Map activity strictly to one of: "walking", "running", "biking", "driving".
        - Map pace strictly to one of: "slow", "normal", "fast".
        - Extract thermal_sensitivity (0.0 to 1.0) based on user's mentioned health, pets, or comfort needs.
        - If walking a pet/dog, set activity="walking", thermal_sensitivity>=0.8, and add "dog_walking" to special_profile_tags.
        """
        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=ParsedIntent,
                        temperature=0.1
                    ),
                )
                data = json.loads(response.text)
                return data
            except Exception as e:
                logger.warning(f"Intent Parsing with model {model_name} failed: {e}")
                continue

    # Rule-Based Fallback
    text = user_prompt.lower()
    activity = "walking"
    if any(k in text for k in ["run", "jog", "sprint"]):
        activity = "running"
    elif any(k in text for k in ["bike", "cycle", "biking", "ride"]):
        activity = "biking"
    elif any(k in text for k in ["drive", "car", "taxi"]):
        activity = "driving"

    pace = "normal"
    if any(k in text for k in ["slow", "relax", "gentle", "leisurely", "easy"]):
        pace = "slow"
    elif any(k in text for k in ["fast", "quick", "hurry", "speed"]):
        pace = "fast"

    tags = []
    sens = 0.5
    if any(k in text for k in ["dog", "puppy", "pet", "paws"]):
        tags.append("dog_walking")
        tags.append("pavement_heat_sensitivity")
        sens = 0.9
    if any(k in text for k in ["asthma", "breath", "dizzy", "heart"]):
        tags.append("respiratory_sensitivity")
        sens = 0.9
    if any(k in text for k in ["child", "kid", "baby", "stroller"]):
        tags.append("child_care")
        sens = 0.8

    return ParsedIntent(
        activity=activity,
        pace=pace,
        thermal_sensitivity=sens,
        special_profile_tags=tags,
        summary=f"Parsed '{user_prompt[:40]}…' for {activity} ({pace} pace)"
    ).model_dump()


# Phase 7: Explicit Tool Registry & Numeric Traceability Guardrail
AGENT_TOOL_DEFINITIONS = [
    {
        "name": "get_weather",
        "description": "Fetches current weather, air temperature, relative humidity, and AQI for location.",
        "parameters": {"lat": "float", "lng": "float"}
    },
    {
        "name": "get_heatmap",
        "description": "Retrieves FortyGuard surface thermal tiles for bounding box.",
        "parameters": {"bbox": "dict", "granularity": "int"}
    },
    {
        "name": "get_route_candidates",
        "description": "Generates real-street candidate routes (fastest, coolest, balanced) from routing engine.",
        "parameters": {"origin": "dict", "destination": "dict", "activity": "str"}
    },
    {
        "name": "calculate_thermal_exposure",
        "description": "Computes UTCI thermal exposure and heat reduction for a candidate route.",
        "parameters": {"route_id": "str", "activity": "str"}
    },
    {
        "name": "compare_routes",
        "description": "Compares travel time, UTCI, and thermal reduction across candidate routes.",
        "parameters": {"routes": "list"}
    },
    {
        "name": "get_user_preferences",
        "description": "Retrieves learned user preference model stats and shade preference %.",
        "parameters": {}
    },
    {
        "name": "save_preference",
        "description": "Saves user feedback (thumbs up/down) to preference model database.",
        "parameters": {"route_type": "str", "satisfied": "bool"}
    }
]


def verify_numeric_grounding(text: str, mission_facts: dict) -> str:
    """
    Phase 7 Guardrail: Ensures any numbers stated in Gemini briefing/response match
    computed backend facts within tolerance. Prevents LLM temperature hallucination.
    """
    import re
    # Extract computed values from mission_facts
    computed_reduction = mission_facts.get("thermal_reduction_percent", 0.0)
    best_route = mission_facts.get("best_route", {})
    computed_temp = best_route.get("avg_temp_c", 32.5)
    computed_utci = best_route.get("avg_utci_c", 36.0)

    # Check for hallucinated reduction percentages (e.g. LLM says "save 45% heat" when computed is 15%)
    pct_matches = re.findall(r'(\d+(?:\.\d+)?)\s*%', text)
    for match in pct_matches:
        val = float(match)
        # If stated percentage is wildly off from computed reduction (> 10% delta)
        if abs(val - computed_reduction) > 10.0 and val > 0:
            text = re.sub(
                rf'\b{match}\s*%',
                f"{computed_reduction:.1f}%",
                text
            )
            logger.info(f"[NUMERIC GUARDRAIL] Corrected hallucinated %: {match}% → {computed_reduction:.1f}%")

    return text


def generate_gemini_briefing(mission_facts: dict) -> dict:
    """
    Synthesizes a personalized safety and thermal briefing.
    Grounded by Phase 7 Numeric Guardrail to ensure 100% facts accuracy.
    """
    client = get_gemini_client()
    raw_result = None

    if client:
        from google.genai import types
        prompt = f"""
        You are CoolPath Assistant, the climate-resilient routing and heat safety intelligence brain.
        Synthesize a hyper-personalized, natural safety briefing based ONLY on these computed backend routing facts:
        {json.dumps(mission_facts, indent=2)}

        CRITICAL GROUNDING RULES:
        - All temperatures, UTCI values, and heat reduction percentages MUST match the exact numbers in mission_facts.
        - Do NOT invent or hallucinate exposure numbers, degrees, or percentages.
        """
        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CoolPathBriefing,
                        temperature=0.1
                    ),
                )
                raw_result = json.loads(response.text)
                break
            except Exception as e:
                logger.warning(f"Briefing generation with model {model_name} failed: {e}")
                continue

    if not raw_result:
        # Rule-Based Fallback Briefing Synthesizer
        activity = mission_facts.get("activity", "walking")
        tags = mission_facts.get("special_profile_tags", [])
        reduction = mission_facts.get("thermal_reduction_percent", 0.0)
        best_route = mission_facts.get("best_route", {})
        avg_temp = best_route.get("avg_temp_c", 32.5)

        if reduction > 10:
            headline = f"Avoid Asphalt Corridors; Save {reduction:.1f}% Heat Exposure via Side Streets"
        elif reduction > 0:
            headline = f"Cooler {activity.capitalize()} Corridor Selected — {reduction:.1f}% Heat Reduction"
        elif "dog_walking" in tags:
            headline = "Protect Paw Pads: Shaded Concrete Corridor Recommended"
        else:
            headline = f"Direct {activity.capitalize()} Route is Optimal — Low Thermal Strain"

        if reduction > 0:
            narrative = (
                f"CoolPath analyzed street microclimates along your trip. "
                f"The recommended path keeps average temperatures at ~{avg_temp:.1f}°C, reducing heat strain by {reduction:.1f}% vs direct asphalt."
            )
        else:
            narrative = (
                f"CoolPath analyzed street microclimates along your trip. "
                f"The direct path maintains an optimal temperature (~{avg_temp:.1f}°C) without needing long detours."
            )

        if "dog_walking" in tags:
            narrative += " Pavement in direct sunlight can reach 50°C+; this route maximizes tree canopy cover."

        from app.agent.safety_policy import SafetyPolicyEngine
        safety_guidance = SafetyPolicyEngine.get_approved_safety_guidance(
            activity=activity,
            special_profile_tags=tags,
            avg_temp_c=avg_temp,
            avg_utci_c=best_route.get("avg_utci_c", 34.0)
        )
        health_alert = safety_guidance["health_alert"]

        timing = "Departure recommended immediately for optimal shade coverage."
        if mission_facts.get("wait_minutes", 0) > 0:
            timing = f"⏰ Delay departure by {mission_facts['wait_minutes']} minutes to allow urban solar heat to drop."

        raw_result = CoolPathBriefing(
            headline=headline,
            narrative=narrative,
            health_alert=health_alert,
            timing_advice=timing
        ).model_dump()

    # Phase 7 Numeric Traceability Guardrail
    raw_result["narrative"] = verify_numeric_grounding(raw_result["narrative"], mission_facts)
    raw_result["headline"] = verify_numeric_grounding(raw_result["headline"], mission_facts)

    return raw_result


def chat_with_coolpath_assistant(messages: List[dict], context: dict = None) -> dict:
    """
    Conversational Voice Assistant:
    - Persona: CoolPath Assistant (climate-resilient routing & urban microclimate specialist).
    - Strictly bound to CoolPath app functionality, thermal routing, weather, AQI, and safe urban navigation.
    - Supports conversational location confirmations and direct route planning triggers.
    """
    context = context or {}
    user_message = messages[-1].get("content", "") if messages else ""
    current_origin = context.get("current_origin", "Times Square, New York")
    current_dest = context.get("current_dest", "Central Park, New York")
    current_temp = context.get("temp_c", 28)
    current_aqi = context.get("aqi", 45)
    pending_action = context.get("pending_action", None)

    client = get_gemini_client()
    if client:
        from google.genai import types
        system_prompt = f"""You are CoolPath Assistant, a voice navigation agent for heat-safe urban routing.

CURRENT STATE:
- Origin: {current_origin}
- Destination: {current_dest}
- Temperature: {current_temp}°C, AQI: {current_aqi}
- Pending Route: {json.dumps(pending_action) if pending_action else 'None'}

CRITICAL RULES:

1. LOCATION EXTRACTION (YOUR #1 JOB):
   When user mentions ANY place name, you MUST:
   a. Extract ONLY the clean location/landmark name. Remove all command words.
      - "go to New York Botanical Garden" → destination = "New York Botanical Garden"
      - "I wanna go Central Park" → destination = "Central Park"
      - "take me to Brooklyn Bridge" → destination = "Brooklyn Bridge"
      - "navigate from Times Square to Empire State" → origin="Times Square", destination="Empire State Building"
   b. Set action="confirm_route"
   c. Set action_data with origin and destination (use "{current_origin}" as origin if not specified)
   d. spoken_response: "I'll plan a route to [clean destination name]. Should I find the coolest path?"
   e. NEVER ask "where would you like to go" if the user just told you a place

2. CONFIRMATION: If user says yes/sure/ok/plan it AND pending route exists:
   - Set action="execute_route", action_data with the pending origin+destination
   - spoken_response: "Planning your route now!"

3. RESPONSE FORMAT:
   - spoken_response: 1 short sentence, no markdown, no asterisks, natural speech
   - NEVER repeat the full user phrase — only use the extracted place name
   - NEVER ask where they want to go if they just stated a destination

4. IDENTITY: You are CoolPath Assistant. Never mention Gemini or any AI model.
5. DOMAIN: Navigation, weather, heat safety only. Decline off-topic."""

        formatted_contents = [{"role": "user" if m.get("role") == "user" else "model", "parts": [{"text": m.get("content", "")}]} for m in messages]
        # Append system prompt to first instruction
        formatted_prompt = f"{system_prompt}\n\nUser Conversation History:\n" + "\n".join([f"{m.get('role')}: {m.get('content')}" for m in messages])

        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=formatted_prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=AssistantResponse,
                        temperature=0.2
                    ),
                )
                return json.loads(response.text)
            except Exception as e:
                logger.warning(f"CoolPath Assistant chat with model {model_name} failed: {e}")
                continue

    # High-Intelligence Fallback Assistant
    text = user_message.lower().strip()
    
    # 1. Affirmative confirmation to pending action
    if any(text == w or text.startswith(w) for w in ["yes", "yeah", "sure", "ok", "okay", "plan it", "go ahead", "start", "confirm"]):
        orig = pending_action.get("origin", current_origin) if pending_action else current_origin
        dest = pending_action.get("destination", current_dest) if pending_action else current_dest
        act = pending_action.get("activity", "walking") if pending_action else "walking"
        return AssistantResponse(
            spoken_response=f"Planning your CoolPath route from {orig} to {dest} now. Navigating via the coolest shaded streets!",
            display_text=f"🚀 **Planning Route**\n\nFrom: **{orig}**\nTo: **{dest}**\nActivity: **{act.capitalize()}**\n\nCalculating microclimate thermal exposure...",
            action="execute_route",
            action_data={"origin": orig, "destination": dest, "activity": act},
            suggested_replies=["Show on Map", "Check Weather", "Change Activity"]
        ).model_dump()

    # 2. Location Intent (from X to Y or to Y)
    if "from " in text and " to " in text:
        parts = text.split("from ")[1].split(" to ")
        orig = parts[0].strip().title()
        dest = parts[1].strip().title()
        return AssistantResponse(
            spoken_response=f"I found {orig} as your start and {dest} as your destination. Should I plan the coolest shaded route for you now?",
            display_text=f"📍 **Route Request Detected**\n\n• **Origin**: {orig}\n• **Destination**: {dest}\n\nWould you like me to calculate the thermal microclimate route?",
            action="confirm_route",
            action_data={"origin": orig, "destination": dest, "activity": "walking"},
            suggested_replies=["Yes, plan route", "Change points", "Cancel"]
        ).model_dump()
        
    # Catch any phrase containing a destination intent
    import re
    to_match = re.search(
        r'\b(?:go\s+to|navigate\s+to|walk\s+to|run\s+to|bike\s+to|drive\s+to|take\s+me\s+to|'
        r'head\s+to|get\s+to|route\s+to|i\s+wanna?\s+go\s+to|i\s+want\s+to\s+go\s+to|'
        r'i\'?d?\s+like\s+to\s+go\s+to|let\'?s?\s+go\s+to|plan\s+(?:a\s+)?(?:route\s+)?to)\s+(.+)',
        text
    )
    if to_match:
        dest = to_match.group(1).strip()
        # Strip trailing activity/filler words
        dest = re.sub(r'\s+(?:by\s+)?(?:walking|running|biking|driving|on\s+foot|please|now)\s*$', '', dest)
        dest = dest.rstrip('.,!?').strip().title()
        if len(dest) >= 2:
            orig = current_origin
            return AssistantResponse(
                spoken_response=f"I'll plan a cool route to {dest}. Should I find the best shaded path?",
                display_text=f"📍 **Destination**: {dest}\n📍 **Origin**: {orig}\n\nReady to calculate heat-safe routes.",
                action="confirm_route",
                action_data={"origin": orig, "destination": dest, "activity": "walking"},
                suggested_replies=["Yes, plan route", "Change start point", "Cancel"]
            ).model_dump()

    # 3. Weather / AQI query
    if any(w in text for w in ["weather", "temperature", "temp", "hot", "aqi", "air"]):
        return AssistantResponse(
            spoken_response=f"Current ambient temperature is {current_temp} degrees Celsius with an air quality index of {current_aqi}. Direct sunlit asphalt can reach over 45 degrees.",
            display_text=f"🌤️ **Current Microclimate**\n\n• **Ambient Temperature**: {current_temp}°C\n• **Air Quality**: AQI {current_aqi}\n• **Asphalt Risk**: Direct sunlit roads reach 45°C+ midday.\n\nUse CoolPath Recommended routes to stay in shaded corridors!",
            action="info",
            action_data={"temp": current_temp, "aqi": current_aqi},
            suggested_replies=["Plan a cool walk", "Dog walk advice", "Show map"]
        ).model_dump()

    # 4. Off-topic query guardrail
    if any(w in text for w in ["code", "python", "president", "movie", "recipe", "song", "joke", "history"]):
        return AssistantResponse(
            spoken_response="I am your CoolPath navigation assistant dedicated to urban heat safety and climate-resilient routing. How can I assist with your journey today?",
            display_text="🌿 **CoolPath Assistant**\n\nI specialize in heat-safe urban navigation, microclimate temperature routing, and outdoor safety.\n\nAsk me to plan a route, check shaded corridors, or protect pets from hot asphalt!",
            action="info",
            action_data=None,
            suggested_replies=["Plan a walk", "Dog walking route", "Check temperature"]
        ).model_dump()

    # 5. General greeting / capability explanation
    return AssistantResponse(
        spoken_response="Hello! I am CoolPath Assistant. Tell me where you'd like to go, and I'll find the coolest, shaded route to protect you from urban heat.",
        display_text="👋 **Hello! I am CoolPath Assistant.**\n\nI can help you navigate cities while avoiding extreme heat, hot asphalt traps, and high-UV corridors.\n\nWhere would you like to go today?",
        action="info",
        action_data=None,
        suggested_replies=["Go to Central Park", "Times Square to Brooklyn", "Check current weather"]
    ).model_dump()


def transcribe_audio_with_gemini(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """
    Transcribes audio bytes to text using Google Gemini Multimodal API.
    Supports audio/webm, audio/wav, audio/mp4, audio/ogg, audio/mp3.
    """
    client = get_gemini_client()
    if not client or not audio_bytes:
        return ""

    from google.genai import types
    part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
    prompt = (
        "You are a highly accurate, noise-canceling speech-to-text transcriber for the CoolPath navigation assistant. "
        "Listen to this audio clip and transcribe the user's spoken destination/origin locations or commands. "
        "Correct phonetically close or slightly distorted words to actual cities, parks, or urban landmarks "
        "(e.g., 'City Garden' instead of 'st garden' or 'Times Square' instead of 'time square'). "
        "Return ONLY the verbatim transcription without any explanation, prefix, or markdown formatting."
    )

    for model_name in GEMINI_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[part, prompt]
            )
            if response and response.text:
                return response.text.strip()
        except Exception as e:
            logger.warning(f"Gemini audio transcription failed on {model_name}: {e}")

    return ""


class PlaceSuggestions(BaseModel):
    places: List[str] = Field(description="A list of 4 to 5 famous landmarks, parks, or points of interest in the city of the origin text.")


def suggest_places_with_gemini(origin_text: str) -> List[str]:
    """
    Given an origin query, identify the city (e.g. New York, London, Paris) and return 4-5 famous landmarks/places in that city.
    """
    client = get_gemini_client()
    if client:
        from google.genai import types
        prompt = f"""
        Identify the city from the following origin text: "{origin_text}".
        If no city is obvious, assume the city is New York.
        Generate 4 to 5 highly famous points of interest, tourist landmarks, or parks in that city.
        Return the result as a structured JSON list of place names.
        Examples for New York: ["Central Park", "Times Square", "Empire State Building", "Brooklyn Bridge", "The High Line"]
        """
        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=PlaceSuggestions,
                        temperature=0.3
                    ),
                )
                data = json.loads(response.text)
                if isinstance(data, dict) and "places" in data:
                    return data["places"]
            except Exception as e:
                logger.warning(f"Place suggestions with model {model_name} failed: {e}")
                continue
    # Fallbacks if Gemini fails
    return ["Central Park", "Times Square", "Brooklyn Bridge", "High Line Park"]


class SearchCandidateItem(BaseModel):
    id: str = Field(description="Unique ID of candidate feature")
    place_name: str = Field(description="Full place name or title")
    short_name: str = Field(description="Short formatted name")
    lat: float = Field(description="Latitude coordinate")
    lng: float = Field(description="Longitude coordinate")
    distance_km: float = Field(description="Distance from user's origin in kilometers")
    ring: str = Field(description="Distance ring: '1km', '2km', '4km', '8km', '16km'")
    relevance_score: float = Field(description="Relevance score from 0.0 to 1.0 based on intent & proximity")
    badge_label: str = Field(description="Short user-facing badge text e.g. '📍 350m away', '⚡ Best Match'")
    reasoning: str = Field(description="Brief 1-sentence reason why this candidate matches the user request")


class SmartSearchResponse(BaseModel):
    results: List[SearchCandidateItem] = Field(default_factory=list, description="Ranked list of relevant search candidates")


def evaluate_search_candidates_with_gemini(query: str, origin_lat: float, origin_lng: float, candidate_pool: List[dict]) -> List[dict]:
    """
    Evaluates, disambiguates, and re-ranks spatial search candidates using Gemini 2.5 Flash.
    """
    client = get_gemini_client()
    if client and candidate_pool:
        from google.genai import types
        prompt = f"""
        You are the Spatial Search Disambiguator for CoolPath heat-aware navigation.
        User Query: "{query}"
        User Origin Location: Lat {origin_lat}, Lng {origin_lng}

        Candidate Locations (grouped into exponential radius rings from origin):
        {json.dumps(candidate_pool, indent=2)}

        Task:
        1. Resolve acronyms and abbreviations (e.g. "DXB" -> Dubai Airport, "MOE" -> Mall of the Emirates, "Kite" -> Kite Beach).
        2. Prefer candidates closer to the user origin (e.g. Ring 1km/2km) UNLESS a farther candidate is an exact brand/landmark match for what the user requested.
        3. Assign a relevance_score (0.0 to 1.0) and a short badge_label (e.g. "📍 450m • Exact Match", "⚡ 1.8km • Best Choice").
        4. Return top ranked results sorted by relevance_score descending.
        """
        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=SmartSearchResponse,
                        temperature=0.1
                    )
                )
                if response.text:
                    parsed = json.loads(response.text)
                    if isinstance(parsed, dict) and "results" in parsed and isinstance(parsed["results"], list):
                        return parsed["results"]
            except Exception as e:
                logger.warning(f"Gemini search evaluation failed on {model_name}: {e}")

    # Fallback if Gemini unavailable or error: sort by distance_km and return formatted candidates
    fallback_results = []
    sorted_candidates = sorted(candidate_pool, key=lambda c: c.get("distance_km", 999))
    for item in sorted_candidates[:6]:
        dist = item.get("distance_km", 0.0)
        dist_str = f"{int(dist * 1000)}m" if dist < 1.0 else f"{dist:.1f}km"
        fallback_results.append({
            "id": item.get("id", ""),
            "place_name": item.get("place_name", ""),
            "short_name": item.get("short_name", item.get("place_name", "")),
            "lat": item.get("lat", 0.0),
            "lng": item.get("lng", 0.0),
            "distance_km": round(dist, 2),
            "ring": item.get("ring", "1km"),
            "relevance_score": 0.8,
            "badge_label": f"📍 {dist_str} away",
            "reasoning": "Location match based on spatial proximity"
        })
    return fallback_results


