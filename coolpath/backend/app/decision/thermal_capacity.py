from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from app.models.policy import ThermalPolicy
from app.models.evidence import ThermalEvidence
from app.models.feasibility import MissionFeasibility

class ThermalCapacityAdapter:
    """
    Translates thermal intelligence into an operational feasibility constraint.
    Does NOT select the final route or action.
    """
    
    @staticmethod
    def evaluate_candidate(
        candidate_id: str,
        route_id: str,
        departure_at: datetime,
        travel_minutes: float,
        outdoor_minutes: float,
        sla_deadline: datetime,
        priority: str,
        thermal_policy: ThermalPolicy,
        thermal_evidence: ThermalEvidence,
        calculated_exposure: Optional[float] = None
    ) -> MissionFeasibility:
        violations = []
        warnings = []
        
        # 1. SLA check
        completion_time = departure_at + timedelta(minutes=(travel_minutes + outdoor_minutes))
        sla_met = completion_time <= sla_deadline
        if not sla_met:
            violations.append(f"Mission completion ({completion_time.time()}) exceeds SLA deadline ({sla_deadline.time()}).")
            
        # 2. Priority policy check (Are there constraints around emergency?)
        priority_policy_met = True
        
        # 3. Thermal policy check
        thermal_policy_met = True
        
        if thermal_policy.max_continuous_outdoor_minutes is not None:
            if outdoor_minutes > thermal_policy.max_continuous_outdoor_minutes:
                thermal_policy_met = False
                violations.append(f"Outdoor duration ({outdoor_minutes}m) exceeds policy maximum ({thermal_policy.max_continuous_outdoor_minutes}m).")
                
        if thermal_policy.threshold is not None and calculated_exposure is not None:
            if calculated_exposure > thermal_policy.threshold:
                thermal_policy_met = False
                violations.append(f"Calculated exposure ({calculated_exposure}) exceeds policy threshold ({thermal_policy.threshold}).")
                
        feasible = sla_met and thermal_policy_met and priority_policy_met
        
        return MissionFeasibility(
            candidate_id=candidate_id,
            route_id=route_id,
            feasible=feasible,
            sla_met=sla_met,
            thermal_policy_met=thermal_policy_met,
            priority_policy_met=priority_policy_met,
            travel_minutes=travel_minutes,
            outdoor_minutes=outdoor_minutes,
            completion_time=completion_time,
            calculated_exposure=calculated_exposure,
            violations=violations,
            warnings=warnings,
            thermal_evidence_id=thermal_evidence.evidence_id
        )
