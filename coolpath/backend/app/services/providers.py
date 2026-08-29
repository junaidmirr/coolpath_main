import uuid
from datetime import datetime, timezone
from typing import List

from app.services.provider_interfaces import (
    RouteSnapshot,
    WorkOrderProvider,
    ThermalProvider,
    RoutingProvider
)
from app.models.evidence import ThermalEvidence
from app.services.thermal_provider import FortyGuardThermalProvider
from app.services.routing import compute_real_street_candidate_routes

class MockWorkOrderProvider:
    async def get_work_order(self, work_order_id: str) -> dict:
        return {
            "work_order_id": work_order_id,
            "task_type": "repair",
            "job_location": {"lat": 40.71, "lng": -74.01},
            "estimated_outdoor_minutes": 45,
            "priority": "NORMAL",
            "sla_deadline_iso": "2026-08-29T16:00:00Z"
        }
        
    async def get_crew_context(self, crew_id: str) -> dict:
        return {
            "crew_id": crew_id,
            "crew_location": {"lat": 40.70, "lng": -74.00},
            "thermal_policy_id": "p1",
            "thermal_policy_version": "v1"
        }

class FortyGuardThermalProviderAdapter:
    def __init__(self):
        self.underlying = FortyGuardThermalProvider()
        
    async def get_thermal_context(
        self, 
        lat: float, 
        lng: float, 
        radius: int, 
        time: datetime
    ) -> ThermalEvidence:
        
        # In a real scenario, this would pass origin/destination instead of single point.
        # But based on the interface, we are fetching for the work area.
        class Point:
            def __init__(self, lat, lng):
                self.lat = lat
                self.lng = lng
                
        # Fake origin/destination around the area to trigger FortyGuard fetch
        p1 = Point(lat - 0.01, lng - 0.01)
        p2 = Point(lat + 0.01, lng + 0.01)
        
        # Prepare environment
        await self.underlying.prepare_environment(p1, p2, [0])
        
        env_summary = self.underlying.get_environmental_summary()
        data_source = env_summary.get("data_source", "microclimate_model")
        
        data_mode = "LIVE"
        coverage_status = "OK"
        if data_source == "static_phoenix_fallback":
            data_mode = "FALLBACK"
            coverage_status = "FALLBACK_DATA_USED"
        elif data_source == "microclimate_model":
            data_mode = "DEGRADED"
            coverage_status = "SYNTHETIC"
            
        evidence = ThermalEvidence(
            evidence_id=f"evt_{uuid.uuid4().hex[:8]}",
            provider="fortyguard",
            requested_at=datetime.now(timezone.utc),
            data_mode=data_mode,
            metric="tcm",
            unit="C",
            freshness_seconds=0, 
            coverage_status=coverage_status
        )
        return evidence

class OSMnxRoutingProviderAdapter:
    def __init__(self, thermal_provider):
        self.thermal_provider = thermal_provider
        
    async def get_routes(
        self, 
        origin: dict, 
        destination: dict, 
        time_offsets: List[int],
        thermal_evidence: ThermalEvidence
    ) -> List[RouteSnapshot]:
        # We need a Coordinate-like object for the routing functions
        class Coordinate:
            def __init__(self, lat, lng):
                self.lat = lat
                self.lng = lng
                
        o = Coordinate(origin["lat"], origin["lng"])
        d = Coordinate(destination["lat"], destination["lng"])
        
        # We loop over time offsets to fetch routes for each offset? 
        # Actually, Phase 3 specifies that RoutingProvider returns RouteSnapshot
        # containing calculated_exposure for EACH offset.
        
        # We'll just fetch routes for offset=0, and then calculate thermal cost for each offset.
        routes_raw = compute_real_street_candidate_routes(
            origin=o, 
            destination=d, 
            activity="walking", 
            provider=self.thermal_provider.underlying, 
            offset_minutes=0
        )
        
        snapshots = []
        for r in routes_raw:
            route_id = r.get("id")
            travel_mins = r.get("duration", r.get("travel_time", 0.0)) / 60.0
            
            calculated_exposure = {}
            for offset in time_offsets:
                # We use the raw average temperature (in °C) times duration (in minutes)
                # to get a genuine C*min metric.
                # NOTE: TEMP_TIME_PROXY_C_MIN is a calculated operational comparison metric, 
                # not a physiological heat-stress measurement (it is not UTCI or WBGT).
                base_temp_c = r.get("avg_temp_c", 36.0)
                # Apply a slight cooling for future offsets as a basic forecast proxy
                temp_at_offset = base_temp_c - (offset * 0.033)
                calculated_exposure[offset] = temp_at_offset * travel_mins
                
            snapshots.append(RouteSnapshot(
                route_id=route_id,
                travel_minutes=travel_mins,
                calculated_exposure=calculated_exposure,
                unit="TEMP_TIME_PROXY_C_MIN",
                geometry=r.get("geometry")
            ))
            
        return snapshots
