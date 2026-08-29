import logging
import uuid
from typing import List, Optional
from sqlalchemy.orm import Session
from app.db.models import DispatchDecisionModel, CandidatePlanModel, DecisionEventModel
from app.models.action import DispatchDecision
from app.models.feasibility import MissionFeasibility

logger = logging.getLogger(__name__)

class DecisionRepository:
    def __init__(self, session: Session):
        self.session = session

    def persist_decision_and_candidates(
        self,
        mission_id: str,
        decision: DispatchDecision,
        candidates: List[MissionFeasibility],
        policy_id: str,
        policy_version: str,
        evaluation_time: str
    ) -> DispatchDecisionModel:
        """
        Persists a decision and its evaluated candidates within the current transaction.
        """
        decision_id = str(uuid.uuid4())
        
        decision_model = DispatchDecisionModel(
            id=decision_id,
            mission_id=mission_id,
            mission_version=decision.mission_version,
            selected_candidate_id=decision.candidate_id,
            action=decision.action,
            reason_codes=[rc.value for rc in decision.reason_codes],
            thermal_evidence_id=decision.evidence_id,
            policy_id=policy_id,
            policy_version=policy_version,
            evaluation_time=evaluation_time
        )
        self.session.add(decision_model)
        
        for candidate in candidates:
            c_model = CandidatePlanModel(
                id=str(uuid.uuid4()),
                decision_id=decision_id,
                candidate_id=candidate.candidate_id,
                route_id=candidate.route_id,
                departure_offset_minutes=candidate.departure_offset_minutes,
                departure_at=candidate.departure_at,
                travel_minutes=candidate.travel_minutes,
                outdoor_minutes=candidate.outdoor_minutes,
                completion_time=candidate.completion_time,
                calculated_exposure=candidate.calculated_exposure,
                unit=candidate.unit,
                sla_met=candidate.sla_met,
                thermal_policy_met=candidate.thermal_policy_met,
                priority_policy_met=candidate.priority_policy_met,
                violations=candidate.violations,
                warnings=candidate.warnings,
                thermal_evidence_id=candidate.thermal_evidence_id
            )
            self.session.add(c_model)
            
        self.session.flush()
        return decision_model

    def append_decision_event(
        self,
        event_type: str,
        mission_id: str,
        mission_version: int,
        decision_id: Optional[str] = None,
        actor_type: str = "SYSTEM",
        actor_id: Optional[str] = None,
        reason_codes: Optional[List[str]] = None,
        evidence_id: Optional[str] = None,
        policy_version: Optional[str] = None,
        payload: Optional[dict] = None,
        idempotency_key: Optional[str] = None
    ) -> DecisionEventModel:
        """
        Appends an immutable operational event for a mission.
        """
        event_model = DecisionEventModel(
            id=str(uuid.uuid4()),
            mission_id=mission_id,
            mission_version=mission_version,
            decision_id=decision_id,
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            reason_codes=reason_codes,
            evidence_id=evidence_id,
            policy_version=policy_version,
            payload=payload,
            idempotency_key=idempotency_key
        )
        self.session.add(event_model)
        self.session.flush()
        return event_model
