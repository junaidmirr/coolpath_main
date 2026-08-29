from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class MissionFeasibility(BaseModel):
    candidate_id: str
    route_id: str

    feasible: bool

    sla_met: bool
    thermal_policy_met: Optional[bool] = None
    priority_policy_met: Optional[bool] = None

    departure_offset_minutes: int
    departure_at: datetime
    travel_minutes: float
    outdoor_minutes: float
    completion_time: datetime

    calculated_exposure: Optional[float] = None
    unit: Optional[str] = None

    violations: List[str]
    warnings: List[str]

    thermal_evidence_id: str
