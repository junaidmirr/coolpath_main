from datetime import datetime, timedelta
from typing import List, Optional
import uuid

from app.models.candidate import MissionCandidate
from app.models.mission import DispatchMissionState
from app.models.policy import ThermalPolicy

class CandidateGenerator:
    """
    Deterministically generates mission alternatives based on 
    current possibilities. Does NOT call live routing APIs.
    """
    
    @staticmethod
    def generate_candidates(
        mission_state: DispatchMissionState,
        routes: List[dict], # Provided by Phase 3 provider snapshot
        time_offsets_minutes: List[int],
        base_time: datetime,
        thermal_evidence_id: str
    ) -> List[MissionCandidate]:
        candidates = []
        for route in routes:
            for offset in time_offsets_minutes:
                departure_at = base_time + timedelta(minutes=offset)
                travel_mins = float(route.get("travel_minutes", 0.0))
                
                # Assume route dict carries 'calculated_exposure' per offset for now, 
                # or a simple heuristic for deterministic tests.
                exposure = route.get("calculated_exposure", None)
                if isinstance(exposure, dict):
                    # Mocking different exposure at different times
                    exposure = exposure.get(offset, None)

                completion_at = departure_at + timedelta(minutes=(travel_mins + mission_state.estimated_outdoor_minutes))
                
                sla_met = completion_at <= mission_state.sla_deadline
                # Thermal policy met is calculated by the ConstraintEvaluator later, 
                # but candidate needs placeholders.
                
                cand = MissionCandidate(
                    candidate_id=f"cand_{route.get('route_id')}_{offset}",
                    departure_at=departure_at,
                    route_id=route.get('route_id'),
                    travel_minutes=travel_mins,
                    outdoor_minutes=float(mission_state.estimated_outdoor_minutes),
                    completion_at=completion_at,
                    calculated_thermal_exposure=exposure,
                    sla_met=sla_met,
                    thermal_policy_met=True, # Placeholder, Evaluator sets this
                    violations=[],
                    warnings=[]
                )
                candidates.append(cand)
        return candidates
