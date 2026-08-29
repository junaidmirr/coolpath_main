from pydantic import BaseModel
from datetime import datetime
from typing import Literal, Optional

class ThermalEvidence(BaseModel):
    evidence_id: str

    provider: Literal["fortyguard"]

    requested_at: datetime
    observed_at: Optional[datetime] = None
    forecast_for: Optional[datetime] = None

    data_mode: Literal[
        "LIVE",
        "CACHED",
        "FALLBACK"
    ]

    granularity_m: Optional[int] = None
    unit: str
    freshness_seconds: int
    activity_id: Optional[str] = None
