from typing import Optional
from sqlalchemy.orm import Session
from app.db.models import DispatchMissionModel
from app.repositories.mission_repository import MissionRepository

class PostgresMissionVersionStore:
    def __init__(self, session: Session):
        self.session = session
        
    def get_latest_version(self, mission_id: str) -> Optional[int]:
        """
        Fetches the absolute latest mission_version directly from the durable PostgreSQL database.
        """
        model = self.session.query(DispatchMissionModel.mission_version).filter_by(id=mission_id).first()
        if model:
            return model[0]
        return None

    def is_superseded(self, mission_id: str, evaluation_version: int) -> bool:
        """
        Returns True if the current database version is strictly greater than
        the version we started evaluating.
        """
        latest_version = self.get_latest_version(mission_id)
        if latest_version is None:
            return False # Mission doesn't exist yet, can't be superseded
            
        return latest_version > evaluation_version
