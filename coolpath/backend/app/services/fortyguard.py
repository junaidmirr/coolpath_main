import httpx
import asyncio
from app.config import FORTYGUARD_API_KEY, DEMO_MODE

BASE_URL = "https://api.fortyguard.com/v1"

async def fetch_heatmap(lat: float, lng: float, radius: int = 1000) -> dict:
    """
    Fetches actual environmental data from FortyGuard using their async polling API.
    In DEMO_MODE, returns an empty result (the simulation handles synthetic data).
    """
    if DEMO_MODE:
        return {"features": []} 
        
    headers = {"api-key": FORTYGUARD_API_KEY}
    
    async with httpx.AsyncClient() as client:
        # Initial request
        post_response = await client.post(
            f"{BASE_URL}/heatmap",
            headers=headers,
            json={"lat": lat, "lng": lng, "radius": radius, "granularity": "80m"}
        )
        
        if post_response.status_code != 200:
            return {}
            
        data = post_response.json()
        activity_id = data.get("activity_id")
        if not activity_id:
            return {}
            
        # Polling for completion
        for _ in range(15):
            await asyncio.sleep(2)
            status_response = await client.get(
                f"{BASE_URL}/status/{activity_id}",
                headers=headers
            )
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                if status_data.get("status") == "completed":
                    return status_data.get("result", {})
                
        return {}
