from pydantic import BaseModel
from datetime import datetime
from typing import Literal, Optional, List

class ThermalEvidence(BaseModel):
    evidence_id: str

    provider: Literal["fortyguard"]

    requested_at: datetime
    observed_at: Optional[datetime] = None
    forecast_for: Optional[datetime] = None

    data_mode: Literal[
        "LIVE",
        "CACHED",
        "FALLBACK",
        "DEGRADED"
    ]

    granularity_m: Optional[int] = None
    metric: str = "tcm"
    unit: str
    freshness_seconds: int
    activity_id: Optional[str] = None
    coverage_status: Optional[str] = None
    warnings: List[str] = []
