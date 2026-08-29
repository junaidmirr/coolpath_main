from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class MissionFeasibility(BaseModel):
    candidate_id: str

    feasible: bool

    sla_met: bool
    thermal_policy_met: bool
    priority_policy_met: bool

    travel_minutes: float
    outdoor_minutes: float
    completion_time: datetime

    calculated_exposure: Optional[float] = None

    violations: List[str]
    warnings: List[str]

    thermal_evidence_id: str
