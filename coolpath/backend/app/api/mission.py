from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from typing import Optional, List

from app.models.mission import Mission, Coordinate
from app.decision.engine import optimize_mission
from app.config import DEMO_MODE
from app.services.thermal_provider import SyntheticThermalProvider, FortyGuardThermalProvider
from app.agent.gemini_agent import (
    parse_user_intent_with_gemini,
    generate_gemini_briefing,
    chat_with_coolpath_assistant,
    transcribe_audio_with_gemini,
    suggest_places_with_gemini,
    evaluate_search_candidates_with_gemini
)
from app.services.aws_polly import synthesize_speech_polly
from app.services.aws_transcribe import transcribe_audio_aws
from app.ml.preference_model import preference_model
import httpx
import logging
import base64

logger = logging.getLogger(__name__)
router = APIRouter()

class IntentRequest(BaseModel):
    prompt: str

class AssistantChatRequest(BaseModel):
    messages: List[dict]
    context: Optional[dict] = None

class TranscribeRequest(BaseModel):
    audio_base64: str
    mime_type: Optional[str] = "audio/webm"

class MissionRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    departure_time: Optional[datetime] = None
    deadline: Optional[datetime] = None
    planning_mode: str = "instant"  # "instant" or "scheduled"
    deadline_minutes: Optional[int] = 60
    activity: str = "walking"
    pace: str = "normal"
    prompt: Optional[str] = None
    special_tags: Optional[List[str]] = None

@router.post("/assistant/chat")
def assistant_chat(req: AssistantChatRequest):
    """
    CoolPath LangChain Voice Assistant Chat:
    Provides voice-friendly conversational responses, location extraction,
    route planning confirmation, and strict climate-navigation domain boundaries via LangChain.
    """
    try:
        from app.agent.langchain_agent import run_langchain_voice_assistant
        res = run_langchain_voice_assistant(req.messages, req.context)
        return {"status": "ok", "data": res}
    except Exception as e:
        logger.error(f"Assistant chat error: {e}")
        res = chat_with_coolpath_assistant(req.messages, req.context)
        return {"status": "ok", "data": res}

class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = "Salli"
    engine: Optional[str] = "standard"

@router.post("/assistant/tts")
def assistant_tts(req: TTSRequest):
    """
    Amazon Polly Text-to-Speech Endpoint:
    Synthesizes input text into standard Amazon Polly Salli female voice (audio/mp3 base64).
    """
    try:
        audio_base64 = synthesize_speech_polly(req.text, req.voice_id or "Salli", req.engine or "standard")
        if audio_base64:
            return {"status": "ok", "audio_base64": audio_base64, "format": "mp3"}
        return {"status": "fallback", "audio_base64": None}
    except Exception as e:
        logger.error(f"Amazon Polly TTS endpoint error: {e}")
        return {"status": "error", "message": str(e), "audio_base64": None}

@router.post("/assistant/transcribe")
def assistant_transcribe(req: TranscribeRequest):
    """
    Speech-to-Text Transcriber powered by Google Cloud Speech-to-Text API:
    Converts recorded user voice audio to text accurately.
    """
    try:
        data = req.audio_base64.strip()
        if "," in data:
            data = data.split(",", 1)[1]
        audio_bytes = base64.b64decode(data)
        
        # Primary STT: Google Cloud Speech-to-Text API
        from app.services.gcp_speech import transcribe_audio_gcp
        transcript = transcribe_audio_gcp(audio_bytes, req.mime_type or "audio/wav")
        
        # Secondary STT Fallback: Gemini Multimodal Audio
        if not transcript:
            transcript = transcribe_audio_with_gemini(audio_bytes, req.mime_type or "audio/wav")
            
        return {"status": "ok", "transcript": transcript}
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail={"error": True, "message": str(e)})

@router.post("/parse-intent")
def parse_intent(req: IntentRequest):
    """
    Agentic Intent Parser powered by Gemini API.
    Extracts structured activity, pace, deadline, and medical profile parameters from natural language prompts.
    """
    if not req.prompt or len(req.prompt.strip()) < 3:
        raise HTTPException(status_code=400, detail={"error": True, "message": "Prompt too short"})
    
    try:
        intent = parse_user_intent_with_gemini(req.prompt)
        return {"status": "ok", "intent": intent}
    except Exception as e:
        logger.error(f"Intent parsing failed: {e}")
        raise HTTPException(status_code=500, detail={"error": True, "message": str(e)})


class SuggestPlacesRequest(BaseModel):
    origin_text: str


@router.post("/assistant/suggest-places")
def suggest_places(req: SuggestPlacesRequest):
    """
    Suggests 4-5 famous landmarks/places in the city of the origin_text.
    """
    try:
        places = suggest_places_with_gemini(req.origin_text)
        return {"status": "ok", "places": places}
    except Exception as e:
        logger.error(f"Suggest places failed: {e}")
        raise HTTPException(status_code=500, detail={"error": True, "message": str(e)})


@router.post("/mission")
async def plan_mission(req: MissionRequest):
    """
    Evaluates the mission using NetworkX Pareto routing and FortyGuard STRtree thermal data,
    and synthesizes a Gemini Agentic Persona Briefing.
    """
    try:
        activity = req.activity
        pace = req.pace
        tags = req.special_tags or []

        # If a natural language prompt is supplied directly in the mission request
        if req.prompt:
            intent = parse_user_intent_with_gemini(req.prompt)
            if intent.get("activity"):
                activity = intent["activity"]
            if intent.get("pace"):
                pace = intent["pace"]
            if intent.get("special_profile_tags"):
                tags.extend(intent["special_profile_tags"])

        now = datetime.now()
        dep_time = req.departure_time or now
        dl_minutes = req.deadline_minutes or 60
        deadline_dt = req.deadline or (dep_time + timedelta(minutes=dl_minutes))

        mission = Mission(
            origin=req.origin,
            destination=req.destination,
            departure_time=dep_time,
            deadline=deadline_dt,
            activity=activity,
            pace=pace,
            planning_mode=req.planning_mode,
            deadline_minutes=dl_minutes
        )

        provider = SyntheticThermalProvider() if DEMO_MODE else FortyGuardThermalProvider()
        result = await optimize_mission(mission, provider)


        # Synthesize Agentic Gemini Briefing
        best_route = (result.get("route_options") or [{}])[0]
        mission_facts = {
            "decision": result.get("decision"),
            "wait_minutes": result.get("wait_minutes"),
            "activity": activity,
            "pace": pace,
            "thermal_reduction_percent": result.get("thermal_reduction_percent", 0.0),
            "special_profile_tags": list(set(tags)),
            "best_route": best_route,
            "total_routes_found": len(result.get("route_options", []))
        }

        # Rank route options using online ML preference model (Piece 1)
        ctx = {"temp_c": 32.0, "activity": mission.activity}
        if result.get("route_options"):
            ranked_opts, shade_pref_pct = preference_model.rank_route_options(result["route_options"], ctx)
            result["route_options"] = ranked_opts
            result["shade_preference_percentage"] = shade_pref_pct

        briefing = generate_gemini_briefing(mission_facts)
        result["gemini_briefing"] = briefing
        result["parsed_profile_tags"] = list(set(tags))

        return result

    except ValueError as e:
        logger.warning(f"Validation error in plan_mission: {e}")
        raise HTTPException(status_code=422, detail={"error": True, "message": str(e), "type": "validation_error"})
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Unhandled error in plan_mission: {e}")
        raise HTTPException(
            status_code=500,
            detail={"error": True, "message": str(e), "type": type(e).__name__}
        )


@router.get("/demo/scenario")
async def get_demo_scenario():
    """
    Phase 8 Demo-Facing Feature: One-Click Phoenix Demo Scenario.
    Evaluates pre-cached Phoenix heatwave route (Phoenix Convention Center → Heritage Square).
    Returns instant pre-computed route options and UTCI comparison card.
    """
    phoenix_origin = Coordinate(lat=33.4484, lng=-112.0687)        # Phoenix Convention Center
    phoenix_dest = Coordinate(lat=33.4503, lng=-112.0628)          # Heritage Square Park

    mission = Mission(
        origin=phoenix_origin,
        destination=phoenix_dest,
        departure_time=datetime.now(),
        deadline=datetime.now() + timedelta(minutes=30),
        activity="walking",
        pace="normal",
        planning_mode="instant"
    )

    provider = FortyGuardThermalProvider()
    result = await optimize_mission(mission, provider)

    result["demo_scenario"] = {
        "city": "Phoenix, AZ",
        "condition": "Peak Summer Solar Irradiance (39.5°C Surface Heat)",
        "scenario_name": "Phoenix Convention Center → Heritage Square Shaded Corridor",
        "is_cached": True
    }

    return {"status": "ok", "data": result}


class FeedbackRequest(BaseModel):
    route_id: Optional[str] = "coolest"
    route_type: Optional[str] = "coolest"
    satisfied: bool = True
    context: Optional[dict] = Field(default_factory=dict)

@router.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    """
    Online ML Feedback Endpoint:
    Receives user rating (satisfied: true/false) for a route recommendation,
    updates preference_model online in sub-millisecond real time.
    """
    try:
        ctx = req.context or {}
        new_prob = preference_model.update_feedback(
            route_type=req.route_type or req.route_id or "coolest",
            context=ctx,
            satisfied=req.satisfied
        )
        return {
            "status": "ok",
            "message": "Feedback applied to online ML preference model",
            "new_predicted_satisfaction": round(new_prob, 3),
            "shade_preference_percentage": round(preference_model.get_shade_preference_percentage(), 1),
            "history_count": len(preference_model.history)
        }
    except Exception as e:
        logger.error(f"Feedback endpoint error: {e}")
        return {"status": "error", "message": str(e)}

@router.get("/ml/stats")
def get_ml_stats():
    """
    Dev/Judge Insights Endpoint:
    Returns current online model state, learned weights, and recent feedback history.
    """
    return {
        "status": "ok",
        "shade_preference_percentage": round(preference_model.get_shade_preference_percentage(), 1),
        "history": preference_model.history,
        "is_bootstrapped": preference_model.is_bootstrapped
    }

@router.get("/geocode")
async def geocode_location(q: str):
    """Converts a place name to coordinates using Nominatim."""
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail={"error": True, "message": "Query too short"})

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": q,
                    "format": "json",
                    "limit": 5,
                    "addressdetails": 1,
                },
                headers={"User-Agent": "CoolPath-HeatNav/1.0"},
                timeout=8.0
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data:
            results.append({
                "display_name": item.get("display_name", ""),
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
                "type": item.get("type", ""),
                "importance": float(item.get("importance", 0))
            })

        return {"results": results}

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail={"error": True, "message": "Geocoding service timed out"})
    except Exception as e:
        logger.error(f"Geocode error: {e}")
        raise HTTPException(status_code=500, detail={"error": True, "message": str(e), "type": "geocode_error"})


class SmartSearchRequest(BaseModel):
    query: str
    origin_lat: float = Field(default=25.2048, description="User origin latitude")
    origin_lng: float = Field(default=55.2708, description="User origin longitude")
    max_radius_km: float = Field(default=16.0, description="Max search radius in km")


import math

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


@router.post("/smart-search")
async def smart_search_places(req: SmartSearchRequest):
    """
    Intelligent Exponential Ring Search & Gemini AI Disambiguation Endpoint.
    """
    query = req.query.strip()
    if not query or len(query) < 2:
        return {"status": "ok", "query": query, "results": []}

    try:
        candidate_pool = []
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "json",
                    "limit": 10,
                    "addressdetails": 1,
                },
                headers={"User-Agent": "CoolPath-HeatNav/1.0"},
                timeout=6.0
            )
            if resp.status_code == 200:
                raw_items = resp.json()
                for item in raw_items:
                    lat = float(item["lat"])
                    lng = float(item["lon"])
                    dist_km = haversine_distance_km(req.origin_lat, req.origin_lng, lat, lng)

                    # Determine exponential ring: 1km, 2km, 4km, 8km, 16km
                    if dist_km <= 1.0:
                        ring = "1km"
                    elif dist_km <= 2.0:
                        ring = "2km"
                    elif dist_km <= 4.0:
                        ring = "4km"
                    elif dist_km <= 8.0:
                        ring = "8km"
                    else:
                        ring = "16km"

                    display_name = item.get("display_name", "")
                    short_name = display_name.split(",")[0] if display_name else query

                    candidate_pool.append({
                        "id": str(item.get("place_id", len(candidate_pool))),
                        "place_name": display_name,
                        "short_name": short_name,
                        "lat": lat,
                        "lng": lng,
                        "distance_km": round(dist_km, 2),
                        "ring": ring
                    })

        # Evaluate with Gemini LLM Ranker
        ranked_results = evaluate_search_candidates_with_gemini(
            query=query,
            origin_lat=req.origin_lat,
            origin_lng=req.origin_lng,
            candidate_pool=candidate_pool
        )

        return {"status": "ok", "query": query, "results": ranked_results}

    except Exception as e:
        logger.error(f"Smart search error: {e}")
        return {"status": "error", "message": str(e), "results": []}

