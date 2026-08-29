from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from app.db.database import Base

class WorkOrderModel(Base):
    __tablename__ = "work_orders"
    
    id = Column(String, primary_key=True)
    external_work_order_id = Column(String, nullable=False)
    task_type = Column(String, nullable=False)
    
    job_lat = Column(Float, nullable=False)
    job_lng = Column(Float, nullable=False)
    
    estimated_outdoor_minutes = Column(Float, nullable=False)
    priority = Column(String, nullable=False)
    sla_deadline = Column(DateTime(timezone=True), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    missions = relationship("DispatchMissionModel", back_populates="work_order")

class DispatchMissionModel(Base):
    __tablename__ = "dispatch_missions"
    
    id = Column(String, primary_key=True)
    session_id = Column(String, nullable=False)
    work_order_id = Column(String, ForeignKey("work_orders.id"), nullable=False)
    
    crew_id = Column(String, nullable=False)
    crew_lat = Column(Float, nullable=False)
    crew_lng = Column(Float, nullable=False)
    
    priority = Column(String, nullable=False)
    sla_deadline = Column(DateTime(timezone=True), nullable=False)
    
    max_dispatch_delay_minutes = Column(Integer, nullable=False)
    
    thermal_policy_id = Column(String, nullable=False)
    thermal_policy_version = Column(String, nullable=False)
    
    mission_version = Column(Integer, nullable=False, default=1)
    
    current_decision_id = Column(String, ForeignKey("dispatch_decisions.id", use_alter=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    work_order = relationship("WorkOrderModel", back_populates="missions")
    decisions = relationship("DispatchDecisionModel", back_populates="mission", foreign_keys="[DispatchDecisionModel.mission_id]")

class ThermalPolicyModel(Base):
    __tablename__ = "thermal_policies"
    
    id = Column(String, primary_key=True)
    policy_id = Column(String, nullable=False)
    policy_version = Column(String, nullable=False)
    
    metric = Column(String, nullable=False)
    unit = Column(String, nullable=True)
    
    threshold = Column(Float, nullable=True)
    max_continuous_outdoor_minutes = Column(Float, nullable=True)
    
    effective_from = Column(DateTime(timezone=True), nullable=True)
    effective_to = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ThermalEvidenceModel(Base):
    __tablename__ = "thermal_evidence"
    
    id = Column(String, primary_key=True)
    provider = Column(String, nullable=False)
    provider_activity_id = Column(String, nullable=True)
    
    requested_at = Column(DateTime(timezone=True), nullable=False)
    observed_at = Column(DateTime(timezone=True), nullable=True)
    forecast_for = Column(DateTime(timezone=True), nullable=True)
    
    data_mode = Column(String, nullable=False)
    freshness_state = Column(String, nullable=False)
    
    metric = Column(String, nullable=False)
    unit = Column(String, nullable=False)
    
    granularity = Column(Integer, nullable=True)
    coverage_status = Column(String, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    decisions = relationship("DispatchDecisionModel", back_populates="thermal_evidence")

class CandidatePlanModel(Base):
    __tablename__ = "candidate_plans"
    
    id = Column(String, primary_key=True)
    decision_id = Column(String, ForeignKey("dispatch_decisions.id"), nullable=False)
    
    candidate_id = Column(String, nullable=False)
    route_id = Column(String, nullable=False)
    
    departure_offset_minutes = Column(Integer, nullable=False)
    departure_at = Column(DateTime(timezone=True), nullable=False)
    
    travel_minutes = Column(Float, nullable=False)
    outdoor_minutes = Column(Float, nullable=False)
    completion_time = Column(DateTime(timezone=True), nullable=False)
    
    calculated_exposure = Column(Float, nullable=True)
    unit = Column(String, nullable=True)
    
    sla_met = Column(Boolean, nullable=False)
    thermal_policy_met = Column(Boolean, nullable=True)
    priority_policy_met = Column(Boolean, nullable=True)
    
    violations = Column(JSON, nullable=True)
    warnings = Column(JSON, nullable=True)
    
    thermal_evidence_id = Column(String, ForeignKey("thermal_evidence.id"), nullable=True)
    
    decision = relationship("DispatchDecisionModel", back_populates="candidates")

class DispatchDecisionModel(Base):
    __tablename__ = "dispatch_decisions"
    
    id = Column(String, primary_key=True)
    mission_id = Column(String, ForeignKey("dispatch_missions.id"), nullable=False)
    mission_version = Column(Integer, nullable=False)
    
    selected_candidate_id = Column(String, nullable=True)
    action = Column(String, nullable=False)
    reason_codes = Column(JSON, nullable=False)
    
    thermal_evidence_id = Column(String, ForeignKey("thermal_evidence.id"), nullable=True)
    policy_id = Column(String, nullable=False)
    policy_version = Column(String, nullable=False)
    
    evaluation_time = Column(DateTime(timezone=True), nullable=False)
    engine_version = Column(String, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    mission = relationship("DispatchMissionModel", back_populates="decisions", foreign_keys=[mission_id])
    thermal_evidence = relationship("ThermalEvidenceModel", back_populates="decisions")
    candidates = relationship("CandidatePlanModel", back_populates="decision")
    events = relationship("DecisionEventModel", back_populates="decision")

class DecisionEventModel(Base):
    """Append-only operational event history"""
    __tablename__ = "decision_events"
    
    id = Column(String, primary_key=True)
    mission_id = Column(String, ForeignKey("dispatch_missions.id"), nullable=False)
    mission_version = Column(Integer, nullable=False)
    decision_id = Column(String, ForeignKey("dispatch_decisions.id"), nullable=True)
    
    event_type = Column(String, nullable=False)
    actor_type = Column(String, nullable=False)
    actor_id = Column(String, nullable=True)
    
    reason_codes = Column(JSON, nullable=True)
    
    evidence_id = Column(String, ForeignKey("thermal_evidence.id"), nullable=True)
    policy_version = Column(String, nullable=True)
    
    payload = Column(JSON, nullable=True)
    idempotency_key = Column(String, nullable=True, unique=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    mission = relationship("DispatchMissionModel")
    decision = relationship("DispatchDecisionModel", back_populates="events")
