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
        "SIMULATED",
        "DEGRADED"
    ]

    granularity_m: Optional[int] = None
    metric: str = "tcm"
    unit: str
    freshness_seconds: int
    freshness_status: Literal["FRESH", "STALE_ALLOWED", "EXPIRED"] = "FRESH"
    activity_id: Optional[str] = None
    coverage_status: Optional[str] = None
    warnings: List[str] = []

def evaluate_freshness(
    evidence: ThermalEvidence,
    reference_time: datetime,
    max_fresh_seconds: int = 900,  # 15 minutes
    max_stale_seconds: int = 3600  # 1 hour
) -> Literal["FRESH", "STALE_ALLOWED", "EXPIRED"]:
    """
    Centralized freshness evaluation.
    Hierarchy of reference: observed_at -> forecast_for -> requested_at.
    """
    if evidence.observed_at:
        age_seconds = (reference_time - evidence.observed_at).total_seconds()
    elif evidence.forecast_for:
        # Forecasts might be in the future, so age could be negative.
        # We consider age from the time it was generated, which might be requested_at
        # but if we strictly use forecast_for, it's about validity.
        # For simplicity, if we have a forecast, its "age" in terms of staleness is
        # relative to the forecast time.
        age_seconds = (reference_time - evidence.forecast_for).total_seconds()
    else:
        age_seconds = (reference_time - evidence.requested_at).total_seconds()
        
    evidence.freshness_seconds = int(age_seconds)
    
    if age_seconds < 0:
        # Future forecast, considered fresh
        evidence.freshness_status = "FRESH"
    elif age_seconds <= max_fresh_seconds:
        evidence.freshness_status = "FRESH"
    elif age_seconds <= max_stale_seconds:
        evidence.freshness_status = "STALE_ALLOWED"
    else:
        evidence.freshness_status = "EXPIRED"
        
    return evidence.freshness_status
