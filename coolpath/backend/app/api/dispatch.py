import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app.agent.gemini_agent import parse_user_intent_with_gemini
from app.agent.graph import agent_executor
from app.agent.state import MissionPatch
from app.db.database import SessionLocal
from app.models.mission import Coordinate, DispatchMissionState
from app.repositories.decision_repository import DecisionRepository
from app.repositories.evidence_repository import EvidenceRepository
from app.repositories.mission_repository import MissionRepository

logger = logging.getLogger(__name__)
router = APIRouter()


class IntentRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)


class MissionRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    departure_time: Optional[datetime] = None
    deadline: Optional[datetime] = None
    planning_mode: str = "instant"
    deadline_minutes: int = Field(default=60, ge=1, le=1440)
    activity: str = "walking"
    pace: str = "normal"
    prompt: Optional[str] = Field(default=None, max_length=2000)
    special_tags: List[str] = Field(default_factory=list)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _build_mission(req: MissionRequest, mission_id: str) -> DispatchMissionState:
    now = datetime.now(timezone.utc)
    departure = _as_utc(req.departure_time) if req.departure_time else now
    deadline = _as_utc(req.deadline) if req.deadline else departure + timedelta(
        minutes=req.deadline_minutes
    )
    priority = "EMERGENCY" if "emergency" in {
        tag.strip().lower() for tag in req.special_tags
    } else "NORMAL"

    return DispatchMissionState(
        session_id=mission_id,
        mission_version=0,
        work_order_id=f"web-{mission_id}",
        task_type=req.activity if req.activity in {"walking", "running", "biking", "driving"} else "walking",
        crew_id="web-user",
        crew_location=req.origin,
        job_location=req.destination,
        estimated_outdoor_minutes=0,
        priority=priority,
        sla_deadline=deadline,
        max_dispatch_delay_minutes=60 if req.planning_mode == "scheduled" else 0,
        thermal_policy_id="default-operational-policy",
        thermal_policy_version="v1",
        created_at=now,
        updated_at=now,
    )


def _persist_result(result: dict) -> str:
    mission = result["mission_state"]
    evidence = result["thermal_evidence"]
    decision = result["selected_decision"]
    candidates = result.get("feasibilities", [])

    try:
        with SessionLocal.begin() as session:
            MissionRepository(session).create_mission(mission)
            EvidenceRepository(session).persist_evidence(evidence)
            decision_repo = DecisionRepository(session)
            decision_model = decision_repo.persist_decision_and_candidates(
                mission_id=mission.session_id,
                decision=decision,
                candidates=candidates,
                policy_id=mission.thermal_policy_id,
                policy_version=mission.thermal_policy_version,
                evaluation_time=datetime.now(timezone.utc),
            )
            decision_repo.append_decision_event(
                event_type="DECISION_SELECTED",
                mission_id=mission.session_id,
                mission_version=mission.mission_version,
                decision_id=decision_model.id,
                reason_codes=[code.value for code in decision.reason_codes],
                evidence_id=evidence.evidence_id,
                policy_version=mission.thermal_policy_version,
                payload={"action": decision.action},
                idempotency_key=f"{mission.session_id}:{mission.mission_version}:decision",
            )
            return decision_model.id
    except SQLAlchemyError:
        logger.error("Mission result persistence failed")
        raise


def _mission_response(req: MissionRequest, result: dict, decision_id: str) -> dict:
    mission = result["mission_state"]
    evidence = result["thermal_evidence"]
    decision = result["selected_decision"]
    routes = result.get("route_snapshots", [])
    feasibilities = result.get("feasibilities", [])

    selected = next(
        (item for item in feasibilities if item.candidate_id == decision.candidate_id),
        None,
    )
    selected_offset = selected.departure_offset_minutes if selected else 0
    selected_route_id = selected.route_id if selected else "fastest"
    fastest = next((route for route in routes if route.route_id == "fastest"), routes[0])
    selected_route = next(
        (route for route in routes if route.route_id == selected_route_id),
        fastest,
    )

    fastest_exposure = float(fastest.calculated_exposure.get(0, 0.0))
    selected_exposure = float(
        selected_route.calculated_exposure.get(selected_offset, 0.0)
    )
    reduction = (
        max(0.0, (fastest_exposure - selected_exposure) / fastest_exposure * 100.0)
        if fastest_exposure > 0
        else 0.0
    )

    route_options = []
    for route in routes:
        exposure = float(route.calculated_exposure.get(selected_offset, 0.0))
        avg_temp = exposure / route.travel_minutes if route.travel_minutes else 0.0
        route_reduction = (
            max(0.0, (fastest_exposure - exposure) / fastest_exposure * 100.0)
            if fastest_exposure > 0
            else 0.0
        )
        is_recommended = route.route_id == selected_route.route_id
        route_options.append(
            {
                "id": route.route_id,
                "name": "Selected Route" if is_recommended else "Route Option",
                "tag": "Recommended" if is_recommended else "Alternative",
                "travel_minutes": round(route.travel_minutes, 1),
                "avg_temp_c": round(avg_temp, 1),
                "thermal_exposure": round(exposure, 1),
                "thermal_reduction_percent": round(route_reduction, 1),
                "coordinates": route.geometry or [],
                "explanation": (
                    f"Calculated operational exposure: {round(exposure, 1)} "
                    "TEMP_TIME_PROXY_C_MIN."
                ),
                "is_recommended": is_recommended,
            }
        )

    return {
        "mission_id": mission.session_id,
        "mission_version": mission.mission_version,
        "decision_id": decision_id,
        "decision": decision.action,
        "planning_mode": req.planning_mode,
        "wait_minutes": selected_offset,
        "optimal_departure_time": selected.departure_at.isoformat() if selected else None,
        "activity": mission.task_type,
        "recommended_action": {
            "route_id": selected_route.route_id,
            "departure_offset_minutes": selected_offset,
            "pace": req.pace,
        },
        "comparison": {
            "fastest": {
                "travel_minutes": round(fastest.travel_minutes, 1),
                "thermal_exposure": round(fastest_exposure, 1),
            },
            "recommended": {
                "travel_minutes": round(selected_route.travel_minutes, 1),
                "thermal_exposure": round(selected_exposure, 1),
            },
        },
        "thermal_reduction_percent": round(reduction, 1),
        "routes": {
            "fastest": fastest.geometry or [],
            "recommended": selected_route.geometry or [],
        },
        "route_options": route_options,
        "explanation": result.get("explanation") or "Deterministic dispatch recommendation.",
        "reason_codes": [code.value for code in decision.reason_codes],
        "provenance": {
            "routing_provider": "geoapify",
            "thermal_provider": evidence.provider,
            "thermal_data_mode": evidence.data_mode,
            "thermal_evidence_id": evidence.evidence_id,
            "thermal_metric": evidence.metric,
            "persistence": "PERSISTED",
        },
    }


@router.post("/mission")
async def plan_mission(req: MissionRequest):
    mission_id = f"mission-{uuid.uuid4()}"
    mission = _build_mission(req, mission_id)
    state = {
        "request_id": str(uuid.uuid4()),
        "mission_id": mission_id,
        "current_mission_version": 0,
        "evaluation_version": 1,
        "mission_state": mission,
        "mission_patch": MissionPatch(priority=mission.priority),
        "pipeline_events": [],
        "route_snapshots": [],
        "candidate_plans": [],
        "feasibilities": [],
        "defer_persistence": True,
    }

    try:
        result = await agent_executor.ainvoke(
            state,
            config={"configurable": {"thread_id": mission_id}},
        )
    except Exception:
        logger.error("Mission evaluation failed")
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "reason": "mission_evaluation_failed"},
        )

    if result.get("is_superseded"):
        raise HTTPException(
            status_code=409,
            detail={"status": "superseded"},
        )
    if not result.get("selected_decision") or not result.get("thermal_evidence"):
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "reason": "required_provider_data_unavailable"},
        )

    try:
        decision_id = _persist_result(result)
    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "reason": "persistence_failed"},
        )

    return _mission_response(req, result, decision_id)


@router.post("/parse-intent")
def parse_intent(req: IntentRequest):
    return {"status": "ok", "intent": parse_user_intent_with_gemini(req.prompt)}


@router.get("/geocode")
async def geocode(q: str = Query(min_length=2, max_length=200)):
    api_key = os.getenv("GEOAPIFY_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "reason": "geocoding_not_configured"},
        )

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                "https://api.geoapify.com/v1/geocode/search",
                params={"text": q, "limit": 5, "apiKey": api_key},
            )
            response.raise_for_status()
            features = response.json().get("features", [])
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail={"status": "unavailable", "reason": "geocoding_provider_failed"},
        )

    results = []
    for feature in features:
        properties = feature.get("properties", {})
        lat = properties.get("lat")
        lng = properties.get("lon")
        if lat is None or lng is None:
            continue
        results.append(
            {
                "display_name": properties.get("formatted") or properties.get("address_line1") or q,
                "lat": float(lat),
                "lng": float(lng),
            }
        )
    return {"results": results, "provider": "geoapify", "data_mode": "LIVE"}
