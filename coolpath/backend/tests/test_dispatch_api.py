import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.agent.nodes import fetch_thermal_node
from app.main import app
from app.models.action import DispatchDecision
from app.models.evidence import ThermalEvidence
from app.models.feasibility import MissionFeasibility
from app.models.mission import Coordinate, DispatchMissionState
from app.models.reason_codes import ReasonCode
from app.services.provider_interfaces import RouteSnapshot


client = TestClient(app)


def _graph_result() -> dict:
    now = datetime.now(timezone.utc)
    mission = DispatchMissionState(
        session_id="mission-test",
        mission_version=1,
        work_order_id="web-mission-test",
        task_type="walking",
        crew_id="web-user",
        crew_location=Coordinate(lat=33.4484, lng=-112.0740),
        job_location=Coordinate(lat=33.4500, lng=-112.0700),
        estimated_outdoor_minutes=0,
        priority="NORMAL",
        sla_deadline=now + timedelta(hours=1),
        max_dispatch_delay_minutes=0,
        thermal_policy_id="default-operational-policy",
        thermal_policy_version="v1",
        created_at=now,
        updated_at=now,
    )
    evidence = ThermalEvidence(
        evidence_id="evidence-test",
        provider="fortyguard",
        requested_at=now,
        data_mode="LIVE",
        metric="TEMP_TIME_PROXY_C_MIN",
        unit="TEMP_TIME_PROXY_C_MIN",
        freshness_seconds=0,
        coverage_status="OK",
    )
    route = RouteSnapshot(
        route_id="fastest",
        travel_minutes=10.0,
        calculated_exposure={0: 320.0, 15: 310.0},
        unit="TEMP_TIME_PROXY_C_MIN",
        geometry=[[-112.0740, 33.4484], [-112.0700, 33.4500]],
    )
    feasibility = MissionFeasibility(
        candidate_id="cand_fastest_0",
        route_id="fastest",
        feasible=True,
        sla_met=True,
        thermal_policy_met=True,
        departure_offset_minutes=0,
        departure_at=now,
        travel_minutes=10.0,
        outdoor_minutes=0.0,
        completion_time=now + timedelta(minutes=10),
        calculated_exposure=320.0,
        unit="TEMP_TIME_PROXY_C_MIN",
        violations=[],
        warnings=[],
        thermal_evidence_id=evidence.evidence_id,
    )
    decision = DispatchDecision(
        action="DISPATCH_NOW",
        candidate_id=feasibility.candidate_id,
        reason_codes=[ReasonCode.SLA_MET],
        approval_required=False,
        evidence_id=evidence.evidence_id,
        mission_version=1,
    )
    return {
        "mission_state": mission,
        "thermal_evidence": evidence,
        "route_snapshots": [route],
        "feasibilities": [feasibility],
        "selected_decision": decision,
        "explanation": "Deterministic recommendation: DISPATCH_NOW",
        "is_superseded": False,
    }


def test_dispatch_routes_are_registered():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json().get("paths", {})
    assert "/api/mission" in paths
    assert "/api/parse-intent" in paths
    assert "/api/geocode" in paths


def test_mission_returns_persisted_dispatch_contract():
    result = _graph_result()
    with patch(
        "app.api.dispatch.agent_executor.ainvoke",
        new=AsyncMock(return_value=result),
    ), patch("app.api.dispatch._persist_result", return_value="decision-test"):
        response = client.post(
            "/api/mission",
            json={
                "origin": {"lat": 33.4484, "lng": -112.0740},
                "destination": {"lat": 33.4500, "lng": -112.0700},
                "activity": "walking",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "DISPATCH_NOW"
    assert body["decision_id"] == "decision-test"
    assert body["provenance"]["routing_provider"] == "geoapify"
    assert body["provenance"]["thermal_data_mode"] == "LIVE"
    assert body["provenance"]["persistence"] == "PERSISTED"


def test_mission_failure_response_does_not_expose_exception_secrets():
    exposed_value = "postgresql://user:password@example.invalid/database"
    with patch(
        "app.api.dispatch.agent_executor.ainvoke",
        new=AsyncMock(side_effect=RuntimeError(exposed_value)),
    ):
        response = client.post(
            "/api/mission",
            json={
                "origin": {"lat": 33.4484, "lng": -112.0740},
                "destination": {"lat": 33.4500, "lng": -112.0700},
            },
        )

    assert response.status_code == 503
    assert exposed_value not in response.text
    assert response.json()["detail"]["reason"] == "mission_evaluation_failed"


def test_geocode_uses_geoapify_without_returning_api_key(monkeypatch):
    monkeypatch.setenv("GEOAPIFY_API_KEY", "private-test-key")
    provider_response = {
        "features": [
            {
                "properties": {
                    "formatted": "Phoenix Convention Center, Phoenix, AZ",
                    "lat": 33.4484,
                    "lon": -112.0740,
                }
            }
        ]
    }
    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: provider_response

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=mock_response)):
        response = client.get("/api/geocode", params={"q": "Phoenix Convention Center"})

    assert response.status_code == 200
    assert response.json()["provider"] == "geoapify"
    assert "private-test-key" not in response.text


def test_parse_intent_preserves_existing_parser_contract():
    parsed = {"activity": "walking", "pace": "normal"}
    with patch(
        "app.api.dispatch.parse_user_intent_with_gemini",
        return_value=parsed,
    ):
        response = client.post("/api/parse-intent", json={"prompt": "Walk downtown"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "intent": parsed}


def test_fetch_thermal_node_attaches_evidence_id_to_mission_state():
    result = _graph_result()
    mission = result["mission_state"]
    evidence = result["thermal_evidence"]
    state = {"needs_thermal": True, "mission_state": mission}

    with patch(
        "app.agent.nodes.FortyGuardThermalProviderAdapter.get_thermal_context",
        new=AsyncMock(return_value=evidence),
    ):
        updated = asyncio.run(fetch_thermal_node(state))

    assert updated["thermal_evidence"].evidence_id == evidence.evidence_id
    assert updated["mission_state"].thermal_evidence_id == evidence.evidence_id
