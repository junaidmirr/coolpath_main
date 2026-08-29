import pytest
import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

# Mock heavy dependencies missing in this lightweight test environment
sys.modules['shapely'] = MagicMock()
sys.modules['shapely.geometry'] = MagicMock()
sys.modules['shapely.strtree'] = MagicMock()
sys.modules['networkx'] = MagicMock()

from datetime import datetime, timezone
from app.services.providers import (
    MockWorkOrderProvider,
    FortyGuardThermalProviderAdapter,
    OSMnxRoutingProviderAdapter
)

# Mock routing to avoid HTTP calls
import app.services.providers as providers_module
providers_module.compute_real_street_candidate_routes = MagicMock(return_value=[
    {
        "id": "r1",
        "duration": 600.0,
        "thermal_cost": 3.0,
        "geometry": []
    }
])

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_providers(anyio_backend):
    wo_provider = MockWorkOrderProvider()
    
    wo = await wo_provider.get_work_order("wo_123")
    assert wo["work_order_id"] == "wo_123"
    assert wo["priority"] == "NORMAL"
    
    crew = await wo_provider.get_crew_context("crew_abc")
    assert crew["thermal_policy_id"] == "p1"
    
    thermal_adapter = FortyGuardThermalProviderAdapter()
    
    # Fake fetch
    evidence = await thermal_adapter.get_thermal_context(
        lat=40.71,
        lng=-74.01,
        radius=1000,
        time=datetime.now(timezone.utc)
    )
    
    assert evidence.provider == "fortyguard"
    assert evidence.data_mode in ["LIVE", "CACHED", "FALLBACK", "DEGRADED"]
    assert evidence.metric == "TEMP_TIME_PROXY_C_MIN"
    
    routing_adapter = OSMnxRoutingProviderAdapter(thermal_provider=thermal_adapter)
    thermal_adapter.underlying.prepare_environment = AsyncMock()
    
    snapshots = await routing_adapter.get_routes(
        origin={"lat": 40.71, "lng": -74.01},
        destination={"lat": 40.72, "lng": -74.00},
        time_offsets=[0, 15, 30],
        thermal_evidence=evidence,
        activity="walking",
    )
    
    assert isinstance(snapshots, list)
    thermal_adapter.underlying.prepare_environment.assert_called_once()
    # The real Mapbox call might fail depending on token, but let's just see if it doesn't crash
