from typing import List, Optional
from datetime import datetime

from app.models.feasibility import MissionFeasibility
from app.models.mission import DispatchMissionState
from app.models.action import DispatchDecision
from app.models.reason_codes import ReasonCode
from app.models.candidate import MissionCandidate

class DecisionSelector:
    """
    Deterministically ranks candidates and selects the final action.
    """
    
    @staticmethod
    def select_decision(
        feasibilities: List[MissionFeasibility],
        mission_state: DispatchMissionState,
        base_time: datetime,
        current_route_id: str
    ) -> DispatchDecision:
        
        # 1. Filter out candidates that violate HARD CONSTRAINTS
        valid_candidates = [f for f in feasibilities if f.feasible]
        
        if not valid_candidates:
            # ESCALATE if no feasible candidate exists
            # We must determine the reason
            reasons = [ReasonCode.NO_FEASIBLE_CANDIDATE]
            
            # Check if it was purely a thermal policy conflict
            thermal_conflicts = [f for f in feasibilities if not f.thermal_policy_met]
            if len(thermal_conflicts) == len(feasibilities) and len(feasibilities) > 0:
                reasons.append(ReasonCode.NO_POLICY_COMPLIANT_PLAN)
                
            if mission_state.priority == "EMERGENCY":
                reasons.append(ReasonCode.PRIORITY_POLICY_CONFLICT)
                
            return DispatchDecision(
                action="ESCALATE",
                candidate_id=None,
                reason_codes=reasons,
                approval_required=True,
                evidence_id=mission_state.thermal_evidence_id or "unknown",
                mission_version=mission_state.mission_version
            )
            
        # 2. SOFT OBJECTIVES (Ranking)
        # Objectives in order:
        # 1. satisfy all hard constraints (already filtered above)
        # 2. preserve SLA (part of hard constraints, all valid_candidates satisfy it)
        # 3. minimize calculated thermal exposure
        # 4. minimize additional delay (departure_at closeness to base_time)
        # 5. minimize travel time
        
        def rank_key(f: MissionFeasibility):
            exposure = f.calculated_exposure if f.calculated_exposure is not None else float('inf')
            # Assuming candidate ID format "cand_route_offset" we can extract delay, 
            # but f has completion_time. Delay = completion_time - (travel + outdoor).
            # Actually, the user prompt says: "minimize additional delay".
            # We don't have departure_time directly in Feasibility. Let's add delay to Feasibility or derive it.
            # departure_time = completion_time - timedelta(minutes=(travel + outdoor))
            # delay_minutes = (departure_time - base_time).total_seconds() / 60
            delay_minutes = max(0, (f.completion_time - base_time).total_seconds() / 60.0 - (f.travel_minutes + f.outdoor_minutes))
            
            return (
                exposure,
                delay_minutes,
                f.travel_minutes,
                f.candidate_id  # Stable tie-break
            )
            
        valid_candidates.sort(key=rank_key)
        best = valid_candidates[0]
        
        # 3. Map to ACTION
        
        route_id = best.route_id
        
        reasons = []
        if best.departure_offset_minutes > 0:
            action = "DELAY"
            reasons.append(ReasonCode.WITHIN_ALLOWED_DELAY)
        elif route_id != current_route_id:
            action = "REROUTE"
            reasons.append(ReasonCode.ALTERNATE_ROUTE_SELECTED)
        else:
            action = "DISPATCH_NOW"
            reasons.append(ReasonCode.SLA_MET)
            
        if best.calculated_exposure is not None:
            reasons.append(ReasonCode.LOWER_CALCULATED_EXPOSURE)
            
        return DispatchDecision(
            action=action,
            candidate_id=best.candidate_id,
            reason_codes=reasons,
            approval_required=False,
            evidence_id=best.thermal_evidence_id,
            mission_version=mission_state.mission_version
        )
