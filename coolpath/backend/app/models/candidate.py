from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class MissionCandidate(BaseModel):
    candidate_id: str
    departure_at: datetime
    route_id: str
    travel_minutes: float
    outdoor_minutes: float
    completion_at: datetime
    
    calculated_thermal_exposure: Optional[float] = None
    
    sla_met: bool
    thermal_policy_met: bool
    
    violations: List[str]
    warnings: List[str]
