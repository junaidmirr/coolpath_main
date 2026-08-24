from shapely.geometry import Point, Polygon
from typing import Tuple

# M2: Synthetic Environment
# Deterministic mock environmental data independent of FortyGuard

MOCK_CELLS = [
    {
        "id": "hot_corridor",
        # A long vertical hotspot around lon=55.2725
        "geometry": Polygon([
            (55.2720, 25.1950), 
            (55.2740, 25.1950), 
            (55.2740, 25.1980), 
            (55.2720, 25.1980)
        ]),
        "temperature": 44.0
    },
    {
        "id": "cool_park",
        # A cool area to the west of the hotspot
        "geometry": Polygon([
            (55.2680, 25.1940), 
            (55.2710, 25.1940), 
            (55.2710, 25.1990), 
            (55.2680, 25.1990)
        ]),
        "temperature": 34.0
    }
]

# Provide time-based temperature overrides for M5/M6 waiting feature
TIME_OVERRIDES = {
    # If the user waits 30 minutes, the hotspot cools down significantly
    30: {
        "hot_corridor": 37.0,
        "cool_park": 33.0
    }
}

def get_temperature_for_point(lng: float, lat: float, departure_offset_minutes: int = 0) -> Tuple[float, str]:
    """
    Returns (temperature, source) for a given point.
    If departure_offset_minutes is passed, tests temporal environment changes.
    """
    pt = Point(lng, lat)
    
    overrides = TIME_OVERRIDES.get(departure_offset_minutes, {})
    
    for cell in MOCK_CELLS:
        if cell["geometry"].contains(pt):
            temp = overrides.get(cell["id"], cell["temperature"])
            return temp, "synthetic"
            
    # Fallback to a moderate baseline
    return 36.0, "synthetic_fallback"
