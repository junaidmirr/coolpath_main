import pytest
import asyncio
from datetime import datetime, timezone
import httpx
from unittest.mock import patch, MagicMock

import sys
# Mock heavy dependencies missing in this lightweight test environment
sys.modules['shapely'] = MagicMock()
sys.modules['shapely.geometry'] = MagicMock()
sys.modules['shapely.strtree'] = MagicMock()

from app.services.thermal_provider import FortyGuardThermalProvider

class Coordinate:
    def __init__(self, lat, lng):
        self.lat = lat
        self.lng = lng

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_fortyguard_success():
    provider = FortyGuardThermalProvider()
    provider.POLL_INTERVAL_SEC = 0.01  # speed up test
    
    # Mockhttpx AsyncClient
    class MockResponse:
        def __init__(self, json_data, status_code=200):
            self._json_data = json_data
            self.status_code = status_code
            self.text = ""
        def json(self):
            return self._json_data

    call_count = 0
    async def mock_post(*args, **kwargs):
        return MockResponse({"data": {"activity_id": "act_123"}})

    async def mock_get(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            return MockResponse({"data": {"status": "Processing"}})
        return MockResponse({
            "data": {
                "status": "Completed", 
                "result": {
                    "map_data": {
                        "features": [{"properties": {"average_temperature": 38.5}}]
                    }
                }
            }
        })
        
    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("httpx.AsyncClient.get", side_effect=mock_get):
            with patch("app.services.thermal_provider.FORTYGUARD_API_KEY", "fake_key"):
                with patch("app.services.thermal_provider._compute_cache_key", return_value="test_key_1"):
                    await provider.prepare_environment(Coordinate(40.7, -74.0), Coordinate(40.71, -74.01), [0])
                    
    # It should have mapped the features
    assert len(provider.heatmap_features[0]) == 1
    
@pytest.mark.anyio
async def test_fortyguard_failure_fallback():
    provider = FortyGuardThermalProvider()
    provider.POLL_INTERVAL_SEC = 0.01  # speed up test
    
    class MockResponse:
        def __init__(self, json_data, status_code=200):
            self._json_data = json_data
            self.status_code = status_code
            self.text = "Error"
        def json(self):
            return self._json_data

    async def mock_post(*args, **kwargs):
        return MockResponse({}, status_code=500)

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("app.services.thermal_provider.FORTYGUARD_API_KEY", "fake_key"):
            with patch("app.services.thermal_provider._compute_cache_key", return_value="test_key_2"):
                await provider.prepare_environment(Coordinate(40.7, -74.0), Coordinate(40.71, -74.01), [0])
                
    # No features loaded, should fallback
    assert provider.heatmap_features.get(0, []) == []

@pytest.mark.parametrize("status_code", [401, 403, 404, 429, 500, 503])
@pytest.mark.anyio
async def test_fortyguard_failure_matrix(status_code):
    provider = FortyGuardThermalProvider()
    provider.POLL_INTERVAL_SEC = 0.01
    
    class MockResponse:
        def __init__(self, json_data, status_code=200):
            self._json_data = json_data
            self.status_code = status_code
            self.text = "Error"
        def json(self):
            return self._json_data

    async def mock_post(*args, **kwargs):
        return MockResponse({}, status_code=status_code)

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("app.services.thermal_provider.FORTYGUARD_API_KEY", "fake_key"):
            with patch("app.services.thermal_provider._compute_cache_key", return_value=f"test_key_{status_code}"):
                await provider.prepare_environment(Coordinate(40.7, -74.0), Coordinate(40.71, -74.01), [0])
                
    assert provider.heatmap_features.get(0, []) == []

@pytest.mark.anyio
async def test_fortyguard_timeout():
    provider = FortyGuardThermalProvider()
    provider.POLL_INTERVAL_SEC = 0.01
    
    async def mock_post(*args, **kwargs):
        raise httpx.TimeoutException("Timeout")

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("app.services.thermal_provider.FORTYGUARD_API_KEY", "fake_key"):
            with patch("app.services.thermal_provider._compute_cache_key", return_value="test_key_timeout"):
                await provider.prepare_environment(Coordinate(40.7, -74.0), Coordinate(40.71, -74.01), [0])
                
    assert provider.heatmap_features.get(0, []) == []

@pytest.mark.anyio
async def test_fortyguard_malformed_response():
    provider = FortyGuardThermalProvider()
    provider.POLL_INTERVAL_SEC = 0.01
    
    class MockResponse:
        def __init__(self, text, status_code=200):
            self.text = text
            self.status_code = status_code
        def json(self):
            raise ValueError("Invalid JSON")

    async def mock_post(*args, **kwargs):
        return MockResponse("Not JSON", status_code=200)

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("app.services.thermal_provider.FORTYGUARD_API_KEY", "fake_key"):
            with patch("app.services.thermal_provider._compute_cache_key", return_value="test_key_malformed"):
                await provider.prepare_environment(Coordinate(40.7, -74.0), Coordinate(40.71, -74.01), [0])
                
    assert provider.heatmap_features.get(0, []) == []
