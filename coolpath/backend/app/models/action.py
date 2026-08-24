from pydantic import BaseModel
from typing import Optional
from app.models.mission import Coordinate
from datetime import datetime

class Action(BaseModel):
    route_id: str
    departure_offset_minutes: int
    pace: str
    
    # These will be populated during simulation
    feasible: Optional[bool] = None
    arrival_time: Optional[datetime] = None
    thermal_load: Optional[float] = None
    travel_time_minutes: Optional[float] = None
