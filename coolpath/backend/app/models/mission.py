from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class Coordinate(BaseModel):
    lat: float
    lng: float

class DispatchMissionState(BaseModel):
    session_id: str
    mission_version: int = 1

    work_order_id: str
    task_type: str

    crew_id: str
    crew_location: Coordinate
    job_location: Coordinate

    estimated_outdoor_minutes: int

    priority: str  # NORMAL / EMERGENCY
    sla_deadline: datetime

    max_dispatch_delay_minutes: int
    departure_constraint: Optional[str] = None

    thermal_policy_id: str
    thermal_policy_version: str

    candidate_plans: List[str] = []
    selected_plan_id: Optional[str] = None

    decision: Optional[str] = None
    reason_codes: List[str] = []

    thermal_evidence_id: Optional[str] = None

    approval_status: Optional[str] = None
    approved_by: Optional[str] = None
    override_reason: Optional[str] = None

    created_at: datetime
    updated_at: datetime
