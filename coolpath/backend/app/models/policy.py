from pydantic import BaseModel
from typing import Optional

class ThermalPolicy(BaseModel):
    policy_id: str
    policy_version: str

    metric: str
    threshold: Optional[float] = None

    max_continuous_outdoor_minutes: Optional[int] = None

    allow_emergency_override: bool = False
    supervisor_approval_required: bool = True
