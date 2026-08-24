from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class Coordinate(BaseModel):
    lat: float
    lng: float

class Mission(BaseModel):
    origin: Coordinate
    destination: Coordinate
    departure_time: datetime
    deadline: datetime
    activity: str
    pace: str
    planning_mode: str = "instant"  # "instant" or "scheduled"
    deadline_minutes: int = 60
