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
    "gemini-2.5-flash",
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


class AssistantResponse(BaseModel):
    spoken_response: str = Field(description="Concise, clear spoken sentence (1-2 sentences, no markdown symbols or asterisks) perfect for Text-to-Speech voice output.")
    display_text: str = Field(description="Formatted response text for visual UI chat bubble.")
    action: Optional[str] = Field(default=None, description="Action to trigger in app: 'confirm_route', 'execute_route', 'switch_mode', 'info', or null")
    action_data: Optional[Dict[str, Any]] = Field(default=None, description="Action payload, e.g. { origin, destination, activity, pace }")
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


def generate_gemini_briefing(mission_facts: dict) -> dict:
    """
    Synthesizes a personalized safety and thermal briefing.
    """
    client = get_gemini_client()
    if client:
        from google.genai import types
        prompt = f"""
        You are CoolPath Assistant, the climate-resilient routing and heat safety intelligence brain.
        Synthesize a hyper-personalized, natural safety briefing based on these routing facts:
        {json.dumps(mission_facts, indent=2)}
        """
        for model_name in GEMINI_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CoolPathBriefing,
                        temperature=0.3
                    ),
                )
                return json.loads(response.text)
            except Exception as e:
                logger.warning(f"Briefing generation with model {model_name} failed: {e}")
                continue

    # Fallback Briefing Synthesizer
    activity = mission_facts.get("activity", "walking")
    tags = mission_facts.get("special_profile_tags", [])
    reduction = mission_facts.get("thermal_reduction_percent", 0.0)
    best_route = mission_facts.get("best_route", {})
    avg_temp = best_route.get("avg_temp_c", 32.5)

    if reduction > 10:
        headline = f"Avoid Asphalt Corridors; Save {reduction}% Heat Exposure via Side Streets"
    elif reduction > 0:
        headline = f"Cooler {activity.capitalize()} Corridor Selected — {reduction}% Heat Reduction"
    elif "dog_walking" in tags:
        headline = "Protect Paw Pads: Shaded Concrete Corridor Recommended"
    else:
        headline = f"Direct {activity.capitalize()} Route is Optimal — Low Thermal Strain"

    if reduction > 0:
        narrative = (
            f"CoolPath analyzed street microclimates along your trip. "
            f"The recommended path keeps average temperatures at ~{avg_temp}°C, reducing heat strain by {reduction}% vs direct asphalt."
        )
    else:
        narrative = (
            f"CoolPath analyzed street microclimates along your trip. "
            f"The direct path maintains an optimal temperature (~{avg_temp}°C) without needing long detours."
        )

    if "dog_walking" in tags:
        narrative += " Pavement in direct sunlight can reach 50°C+; this route maximizes tree canopy cover."

    health_alert = "Hydrate well and seek shade whenever available during peak midday heat."
    if "dog_walking" in tags or avg_temp > 33.0:
        health_alert = "⚠️ Caution: High asphalt surface heat detected. Check pavement temperature before letting pets walk."
    elif activity == "running":
        health_alert = "🏃 Hyperthermia Risk: High metabolic heat buildup expected during running. Keep pace steady."

    timing = "Departure recommended immediately for optimal shade coverage."
    if mission_facts.get("wait_minutes", 0) > 0:
        timing = f"⏰ Delay departure by {mission_facts['wait_minutes']} minutes to allow urban solar heat to drop."

    return CoolPathBriefing(
        headline=headline,
        narrative=narrative,
        health_alert=health_alert,
        timing_advice=timing
    ).model_dump()


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
        system_prompt = f"""
        You are CoolPath Assistant, the intelligent climate-resilient urban navigation and microclimate thermal routing voice agent.
        
        CURRENT APP CONTEXT:
        - Current Origin Pin: {current_origin}
        - Current Destination Pin: {current_dest}
        - Live Ambient Weather: {current_temp}°C, AQI: {current_aqi}
        - Pending Action State: {json.dumps(pending_action) if pending_action else 'None'}
        
        CORE RULES & BEHAVIOR:
        1. STRICT DOMAIN BOUNDARY: You ONLY answer questions related to CoolPath navigation, heatwave avoidance, urban microclimates, weather, air quality, route planning, walking/biking/driving thermal safety, and pet paw protection.
           - If the user asks general trivia, coding, politics, or off-topic queries, politely decline: "I am your CoolPath navigation assistant dedicated to urban heat safety and climate-resilient routing. How can I help with your journey today?"
        2. CONVERSATIONAL LOCATION CONFIRMATION:
           - If the user specifies places (e.g. "I want to go to Brooklyn Bridge", "Navigate from Times Square to Central Park"):
             a. Identify origin and destination. If only destination is provided, use the user's current location/pin as origin.
             b. Respond with action="confirm_route" and action_data={{ "origin": origin_name, "destination": dest_name, "activity": activity }}.
             c. Spoken response must be conversational confirmation: "I found [Origin] and [Destination]. Should I plan the coolest shaded route for you now?"
           - If the user confirms (e.g. "Yes", "Sure", "Plan it", "Go ahead") and there is a pending route or previous location:
             a. Respond with action="execute_route" and action_data={{ "origin": origin_name, "destination": dest_name, "activity": activity }}.
             b. Spoken response: "Planning your CoolPath route now. Finding the best shaded corridors for your trip!"
        3. VOICE-FRIENDLY SPOKEN RESPONSE:
           - The `spoken_response` field MUST be natural, conversational, and concise (1-2 sentences). Do NOT include markdown symbols, asterisks, or lists in `spoken_response`.
        4. NEVER mention or identify as Gemini. Your name and brand is strictly "CoolPath Assistant".
        """

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
        
    # Catch any phrase containing "to <destination>"
    import re
    to_match = re.search(r'\b(?:go to|navigate to|walk to|take me to|route to|to)\s+(.+)', text)
    if to_match:
        dest = to_match.group(1).strip().title()
        orig = current_origin
        return AssistantResponse(
            spoken_response=f"I set your destination to {dest} from your current starting point. Should I plan the coolest route now?",
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

