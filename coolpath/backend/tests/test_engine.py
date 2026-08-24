from datetime import datetime, timedelta
from app.models.mission import Mission, Coordinate
from app.decision.engine import optimize_mission
from app.services.thermal_provider import SyntheticThermalProvider
import asyncio

async def main():
    print("Starting optimization simulation...")
    
    origin = Coordinate(lat=25.1965, lng=55.2710)
    destination = Coordinate(lat=25.1965, lng=55.2750)
    departure_time = datetime.now()
    deadline = departure_time + timedelta(minutes=60)
    
    mission = Mission(
        origin=origin,
        destination=destination,
        departure_time=departure_time,
        deadline=deadline,
        activity="walking",
        pace="normal"
    )
    
    provider = SyntheticThermalProvider()
    decision = await optimize_mission(mission, provider)
    
    print("\n--- DECISION ENGINE RESULT ---")
    print(f"Decision: {decision['decision']}")
    print(f"Wait Minutes: {decision['wait_minutes']}")
    print(f"Reduction: {decision['thermal_reduction_percent']}%")
    print(f"Fastest TEI: {decision['comparison']['fastest']['thermal_exposure']}")
    print(f"Recommended TEI: {decision['comparison']['recommended']['thermal_exposure']}")

if __name__ == "__main__":
    asyncio.run(main())
