import logging
from sqlalchemy.orm import Session
from app.db.models import ThermalEvidenceModel
from app.models.evidence import ThermalEvidence

logger = logging.getLogger(__name__)

class EvidenceRepository:
    def __init__(self, session: Session):
        self.session = session

    def persist_evidence(self, evidence: ThermalEvidence) -> ThermalEvidenceModel:
        """
        Append-only persistence for ThermalEvidence.
        """
        model = ThermalEvidenceModel(
            id=evidence.evidence_id,
            provider=evidence.provider,
            provider_activity_id=evidence.activity_id,
            requested_at=evidence.requested_at,
            observed_at=evidence.observed_at,
            forecast_for=evidence.forecast_for,
            data_mode=evidence.data_mode,
            freshness_state=evidence.freshness_status,
            metric=evidence.metric,
            unit=evidence.unit,
            granularity=evidence.granularity_m,
            coverage_status=evidence.coverage_status
        )
        self.session.add(model)
        self.session.flush()
        return model
