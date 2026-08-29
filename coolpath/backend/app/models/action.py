from pydantic import BaseModel
from typing import Literal, List, Optional

class DispatchDecision(BaseModel):
    action: Literal[
        "DISPATCH_NOW",
        "DELAY",
        "REROUTE",
        "ESCALATE"
    ]
    candidate_id: Optional[str] = None
    reason_codes: List[str]
    approval_required: bool
    evidence_id: str
