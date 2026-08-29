import asyncio
import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv

# Ensure we are testing with real keys
load_dotenv('.env')

from app.models.mission import Coordinate, DispatchMissionState
from app.services.routing import compute_real_street_candidate_routes
from app.services.thermal_provider import FortyGuardThermalProvider
from app.agent.graph import create_checkpointer
from app.agent.state import CoolPathDispatchState

async def run_geoapify_test():
    print("--- 4. Geoapify Phoenix Routing Smoke Test ---")
    provider = FortyGuardThermalProvider() # mock or real for routing
    o = Coordinate(lat=33.4484, lng=-112.0740)
    d = Coordinate(lat=33.4500, lng=-112.0700)
    routes = compute_real_street_candidate_routes(o, d, "driving", provider)
    
    if routes:
        r = routes[0]
        print("Geoapify Routing Success!")
        print(f"Route: {r['name']}, Duration: {r.get('travel_time')}s, Distance: {r.get('distance', 'N/A')}m")
        print(f"Geometry points: {len(r.get('geometry', []))}")
        return True
    else:
        print("Geoapify Routing Failed or returned no routes.")
        return False

async def run_fortyguard_test():
    print("\n--- 5. FortyGuard Phoenix Request ---")
    provider = FortyGuardThermalProvider()
    class Point:
        def __init__(self, lat, lng):
            self.lat = lat
            self.lng = lng
    p1 = Point(33.4484, -112.0740)
    p2 = Point(33.4500, -112.0700)
    try:
        await provider.prepare_environment(p1, p2, [0])
        summary = provider.get_environmental_summary()
        print("FortyGuard API Success!")
        print(f"Data source: {summary.get('data_source')}")
        print(f"Avg Temp: {summary.get('avg_temp_c')}C")
        return True
    except Exception as e:
        print(f"FortyGuard API Failed: {e}")
        return False

async def run_gemini_test():
    print("\n--- 6. Gemini Structured MissionPatch Request ---")
    try:
        from google import genai
        from app.agent.state import MissionPatch
        
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        prompt = "Create a mission patch with priority EMERGENCY."
        
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=prompt,
            config={
                'response_mime_type': 'application/json',
                'response_schema': MissionPatch,
            },
        )
        
        result = MissionPatch.model_validate_json(response.text)
        print("Gemini API Success!")
        print(f"Result Priority: {result.priority}")
        return True
    except Exception as e:
        print(f"Gemini API Failed: {e}")
        return False

async def run_end_to_end():
    print("\n--- 7. Real End-to-End Mission ---")
    from app.agent.graph import builder
    checkpointer = create_checkpointer()
    graph = builder.compile(checkpointer=checkpointer)
    
    config = {"configurable": {"thread_id": "test_e2e_thread_1"}}
    mission = DispatchMissionState(
        session_id="e2e_mission_1",
        mission_version=1,
        work_order_id="WO-999",
        task_type="repair",
        priority="NORMAL",
        job_location=Coordinate(lat=33.4484, lng=-112.0740),
        crew_id="crew_1",
        crew_location=Coordinate(lat=33.4400, lng=-112.0700),
        estimated_outdoor_minutes=30,
        max_dispatch_delay_minutes=60,
        sla_deadline=datetime.now(timezone.utc),
        thermal_policy_id="1",
        thermal_policy_version="v1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    state: CoolPathDispatchState = {
        "mission_id": "e2e_mission_1",
        "current_mission_version": 1,
        "evaluation_version": 1,
        "mission_state": mission,
        "pipeline_events": [],
        "thermal_evidence": None,
        "route_snapshots": [],
        "candidate_plans": [],
        "feasibilities": [],
        "dirty_fields": ["location_changed"]
    }
    
    try:
        res = await graph.ainvoke(state, config=config)
        print("End-to-End Success!")
        decision = res.get('selected_decision')
        if decision:
            print(f"Final Decision action: {decision.action}")
        else:
            print("No decision selected.")
        return True
    except Exception as e:
        print(f"End-to-End Failed: {e}")
        return False

async def main():
    await run_geoapify_test()
    await run_fortyguard_test()
    await run_gemini_test()
    await run_end_to_end()

if __name__ == "__main__":
    asyncio.run(main())
