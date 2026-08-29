from typing import Protocol, List, Optional
from datetime import datetime

from app.models.mission import DispatchMissionState
from app.models.evidence import ThermalEvidence

class RouteSnapshot:
    """
    Normalized route data returned by a RoutingProvider.
    """
    def __init__(
        self,
        route_id: str,
        travel_minutes: float,
        calculated_exposure: dict, # offset -> exposure
        unit: str,
        geometry: Optional[dict] = None
    ):
        self.route_id = route_id
        self.travel_minutes = travel_minutes
        self.calculated_exposure = calculated_exposure
        self.unit = unit
        self.geometry = geometry
        
class WorkOrderProvider(Protocol):
    async def get_work_order(self, work_order_id: str) -> dict:
        ...
        
    async def get_crew_context(self, crew_id: str) -> dict:
        ...

class ThermalProvider(Protocol):
    async def get_thermal_context(
        self, 
        lat: float, 
        lng: float, 
        radius: int, 
        time: datetime
    ) -> ThermalEvidence:
        ...

class RoutingProvider(Protocol):
    async def get_routes(
        self, 
        origin: dict, 
        destination: dict, 
        time_offsets: List[int],
        thermal_evidence: ThermalEvidence
    ) -> List[RouteSnapshot]:
        ...
