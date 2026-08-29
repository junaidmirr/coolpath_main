from typing import TypedDict, List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field

from app.models.mission import DispatchMissionState
from app.models.evidence import ThermalEvidence
from app.models.candidate import MissionCandidate
from app.services.provider_interfaces import RouteSnapshot
from app.models.feasibility import MissionFeasibility
from app.models.action import DispatchDecision

class MissionPatch(BaseModel):
    """
    Strict structured output for Gemini to mutate the mission.
    Zero mutation tools are given; only this patch is returned.
    """
    priority: Optional[str] = Field(None, description="NORMAL or EMERGENCY")
    sla_deadline: Optional[datetime] = Field(None, description="Updated SLA deadline if provided")

class PipelineEvent(BaseModel):
    timestamp: datetime
    event_type: str
    message: str

class CoolPathDispatchState(TypedDict, total=False):
    # Core identity
    request_id: str
    mission_id: str
    
    # Concurrency and versioning
    current_mission_version: int
    evaluation_version: int
    
    # State tracking
    mission_state: DispatchMissionState
    previous_mission_state: Optional[DispatchMissionState]
    
    # LLM Interaction
    mission_patch: Optional[MissionPatch]
    dirty_fields: List[str]
    replan_reason: Optional[str]
    needs_routing: bool
    needs_thermal: bool
    
    # Provider Data
    thermal_evidence: Optional[ThermalEvidence]
    route_snapshots: List[RouteSnapshot]
    candidate_plans: List[MissionCandidate]
    
    # Engine Results
    feasibilities: List[MissionFeasibility]
    selected_decision: Optional[DispatchDecision]
    
    # Grounded Explanation
    explanation: Optional[str]
    
    # Observability
    pipeline_events: List[PipelineEvent]
    is_superseded: bool
