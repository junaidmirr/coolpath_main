from pydantic import BaseModel
from typing import Literal, List, Optional
from app.models.reason_codes import ReasonCode

class DispatchDecision(BaseModel):
    action: Literal[
        "DISPATCH_NOW",
        "DELAY",
        "REROUTE",
        "ESCALATE"
    ]
    candidate_id: Optional[str] = None
    reason_codes: List[ReasonCode]
    approval_required: bool
    evidence_id: str
    mission_version: int
