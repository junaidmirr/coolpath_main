import logging
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import update
from app.db.models import DispatchMissionModel, WorkOrderModel
from app.models.mission import DispatchMissionState, Coordinate
from app.models.evidence import ThermalEvidence

logger = logging.getLogger(__name__)

class VersionConflictError(Exception):
    """Raised when an optimistic concurrency check fails."""
    pass

class MissionRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_mission(self, mission_id: str) -> Optional[DispatchMissionState]:
        model = self.session.query(DispatchMissionModel).filter_by(id=mission_id).first()
        if not model:
            return None
            
        wo = model.work_order
        if not wo:
            return None

        # Reconstruct the Pydantic state
        return DispatchMissionState(
            session_id=model.session_id,
            work_order_id=model.work_order_id,
            task_type=wo.task_type,
            crew_id=model.crew_id,
            crew_location=Coordinate(lat=model.crew_lat, lng=model.crew_lng),
            job_location=Coordinate(lat=wo.job_lat, lng=wo.job_lng),
            estimated_outdoor_minutes=wo.estimated_outdoor_minutes,
            priority=model.priority,
            sla_deadline=model.sla_deadline,
            max_dispatch_delay_minutes=model.max_dispatch_delay_minutes,
            thermal_policy_id=model.thermal_policy_id,
            thermal_policy_version=model.thermal_policy_version,
            mission_version=model.mission_version,
            created_at=model.created_at,
            updated_at=model.updated_at
        )

    def create_mission(self, state: DispatchMissionState) -> DispatchMissionState:
        # Create or update Work Order
        wo = self.session.query(WorkOrderModel).filter_by(id=state.work_order_id).first()
        if not wo:
            wo = WorkOrderModel(
                id=state.work_order_id,
                external_work_order_id=state.work_order_id,
                task_type=state.task_type,
                job_lat=state.job_location.lat,
                job_lng=state.job_location.lng,
                estimated_outdoor_minutes=state.estimated_outdoor_minutes,
                priority=state.priority,
                sla_deadline=state.sla_deadline
            )
            self.session.add(wo)
            
        mission = DispatchMissionModel(
            id=state.session_id,
            session_id=state.session_id,
            work_order_id=state.work_order_id,
            crew_id=state.crew_id,
            crew_lat=state.crew_location.lat,
            crew_lng=state.crew_location.lng,
            priority=state.priority,
            sla_deadline=state.sla_deadline,
            max_dispatch_delay_minutes=state.max_dispatch_delay_minutes,
            thermal_policy_id=state.thermal_policy_id,
            thermal_policy_version=state.thermal_policy_version,
            mission_version=state.mission_version
        )
        self.session.add(mission)
        self.session.flush()
        return state

    def update_mission_optimistic(self, state: DispatchMissionState, expected_version: int) -> DispatchMissionState:
        """
        Updates the mission safely using optimistic concurrency.
        Increments the mission_version atomically.
        """
        stmt = (
            update(DispatchMissionModel)
            .where(DispatchMissionModel.id == state.session_id)
            .where(DispatchMissionModel.mission_version == expected_version)
            .values(
                priority=state.priority,
                sla_deadline=state.sla_deadline,
                mission_version=expected_version + 1
            )
        )
        
        result = self.session.execute(stmt)
        if result.rowcount == 0:
            raise VersionConflictError(
                f"Version conflict updating mission {state.session_id}. Expected {expected_version}."
            )
            
        # Update the state object version
        state.mission_version = expected_version + 1
        self.session.flush()
        return state
