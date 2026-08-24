import asyncio
from datetime import datetime, timedelta
import os
import sys
import logging

logging.basicConfig(level=logging.INFO)

# Force DEMO_MODE to False
os.environ["DEMO_MODE"] = "false"

from app.models.mission import Mission, Coordinate
from app.decision.engine import optimize_mission
from app.services.thermal_provider import FortyGuardThermalProvider
from app.config import FORTYGUARD_API_KEY

async def main():
    print("FORTYGUARD LIVE TEST\n====================")
    
    if not FORTYGUARD_API_KEY:
        print("ERROR: FORTYGUARD_API_KEY is not set in the environment.")
        print("Please add FORTYGUARD_API_KEY to your backend/.env file to run this live test.")
        sys.exit(1)
        
    print("Request submitted:        YES")
    
    # Lower Manhattan Coordinates (within FortyGuard's verified sample area)
    origin = Coordinate(lat=40.7080, lng=-74.0120)
    destination = Coordinate(lat=40.7140, lng=-74.0060)
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
    
    provider = FortyGuardThermalProvider()
    
    print("\n--- Invoking prepare_environment() ---")
    await provider.prepare_environment(mission.origin, mission.destination, offsets=[0, 30])
    
    print("\n--- GeoJSON Structure Analysis ---")
    if not provider.heatmap_features:
        print("ERROR: No data downloaded from FortyGuard.")
        sys.exit(1)
        
    print("GeoJSON downloaded:       YES")
    
    features = provider.heatmap_features.get(0, [])
    print(f"Feature count:             {len(features)}")
    
    if features:
        sample = features[0]
        print(f"Geometry type:             {sample.get('geometry', {}).get('type')}")
        
        props = sample.get("properties", {})
        temp_keys = [k for k in props.keys() if 'temp' in k.lower() or k == 't']
        
        if temp_keys:
            temp_key = temp_keys[0]
            print(f"Temperature field:         {temp_key}")
            print(f"Temperature sample:        {props[temp_key]}°C")
        else:
            print("Temperature field:         NOT FOUND in properties:", list(props.keys()))
            
    print("\n--- Spatial Matching Verification ---")
    mid_lat = (origin.lat + destination.lat) / 2
    mid_lng = (origin.lng + destination.lng) / 2
    
    temp, source = provider.get_temperature_for_point(mid_lng, mid_lat, 0)
    print(f"Test Point ({mid_lng}, {mid_lat}): {temp}°C (Source: {source})")
    
    if source == "fortyguard_fallback":
        print("ERROR: Point fell back to default. Spatial matching failed or grid didn't cover this area.")
    else:
        print("Spatial matching:          SUCCESS")

    print("\n--- Temporal Request Verification ---")
    temp_30, source_30 = provider.get_temperature_for_point(mid_lng, mid_lat, 30)
    print(f"T0  Temperature: {temp}°C")
    print(f"T30 Temperature: {temp_30}°C")
    
    if temp != temp_30:
        print("Different temporal data:   YES")
    else:
        print("Different temporal data:   NO (API returned same data for both offsets or fallback occurred)")

    print("\n--- Running Optimizer ---")
    decision = await optimize_mission(mission, provider)
    
    print("\n--- FINAL DECISION ---")
    print(f"Decision: {decision['decision']}")
    print(f"Wait Minutes: {decision['wait_minutes']}")
    print(f"Reduction: {decision['thermal_reduction_percent']}%")

if __name__ == "__main__":
    asyncio.run(main())
