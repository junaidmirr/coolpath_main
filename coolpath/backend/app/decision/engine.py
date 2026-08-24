from datetime import datetime, timedelta
from typing import List, Dict, Any
import asyncio
import logging
import osmnx as ox
from concurrent.futures import ThreadPoolExecutor

from app.models.mission import Mission
from app.models.action import Action
from app.services.osm import download_street_network, assign_thermal_weights_and_collapse
from app.services.routing import get_candidate_routes, compute_real_street_candidate_routes

logger = logging.getLogger(__name__)

ACTIVITY_CONFIGS = {
    "walking": {
        "network_type": "walk",
        "speeds": {"slow": 1.1, "normal": 1.4, "fast": 1.7},
        "metabolic_factor": 1.0,
        "name": "walking"
    },
    "running": {
        "network_type": "walk",
        "speeds": {"slow": 2.2, "normal": 2.8, "fast": 3.6},
        "metabolic_factor": 1.8,
        "name": "running"
    },
    "biking": {
        "network_type": "bike",
        "speeds": {"slow": 3.5, "normal": 4.5, "fast": 6.0},
        "metabolic_factor": 1.2,
        "name": "biking"
    },
    "driving": {
        "network_type": "drive",
        "speeds": {"slow": 8.3, "normal": 11.1, "fast": 13.9},
        "metabolic_factor": 0.3,
        "name": "driving"
    }
}

_executor = ThreadPoolExecutor(max_workers=4)


def get_activity_config(activity: str) -> dict:
    act_key = str(activity or "walking").lower()
    return ACTIVITY_CONFIGS.get(act_key, ACTIVITY_CONFIGS["walking"])


def generate_actions(
    routes: List[dict],
    paces: List[str] = ["normal", "slow"],
    departure_offsets: List[int] = [0, 30]
) -> List[Action]:
    actions = []
    for r in routes:
        for offset in departure_offsets:
            for pace in paces:
                actions.append(Action(
                    route_id=r["id"],
                    departure_offset_minutes=offset,
                    pace=pace
                ))
    return actions


def simulate_action(action: Action, mission: Mission, routes_by_offset: dict, activity_cfg: dict) -> Action:
    offset = action.departure_offset_minutes
    if offset not in routes_by_offset:
        action.feasible = False
        return action

    routes_for_offset = routes_by_offset[offset]
    route = next((r for r in routes_for_offset if r["id"] == action.route_id), None)
    if not route:
        action.feasible = False
        return action

    speeds = activity_cfg["speeds"]
    normal_speed = speeds.get("normal", 1.4)
    chosen_speed = speeds.get(action.pace, normal_speed)
    speed_ratio = normal_speed / chosen_speed if chosen_speed > 0 else 1.0

    travel_time_sec = route.get("travel_time", route.get("walk_time", 0.0))
    action.travel_time_minutes = (travel_time_sec * speed_ratio) / 60.0

    # Arrival calculation
    departure_time = mission.departure_time + timedelta(minutes=action.departure_offset_minutes)
    action.arrival_time = departure_time + timedelta(minutes=action.travel_time_minutes)

    # Thermal load calculation: route thermal cost scaled by pace speed ratio
    action.thermal_load = route.get("thermal_cost", 0.0) * speed_ratio

    # Deadline constraint check
    action.feasible = action.arrival_time <= mission.deadline

    return action


def _compute_routes_blocking(mission: Mission, offsets: List[int], provider, activity_cfg: dict):
    """
    Computes 100% real-street turn-by-turn road routes with thermal microclimate scoring.
    Falls back to local street graph if external directions service is unreachable.
    """
    routes_by_offset = {}
    
    # 1. Primary: Real-street turn-by-turn routing with thermal microclimate evaluation
    all_offsets_succeeded = True
    for offset in offsets:
        try:
            real_routes = compute_real_street_candidate_routes(
                origin=mission.origin,
                destination=mission.destination,
                activity=mission.activity,
                provider=provider,
                offset_minutes=offset
            )
            if real_routes and len(real_routes) > 0:
                routes_by_offset[offset] = real_routes
            else:
                all_offsets_succeeded = False
                break
        except Exception as e:
            logger.warning(f"Real-street candidate routing failed for offset {offset}: {e}")
            all_offsets_succeeded = False
            break
            
    if all_offsets_succeeded and len(routes_by_offset) == len(offsets):
        return routes_by_offset

    # 2. Fallback: Graph-based network routing
    logger.info("Using graph-based network routing fallback.")
    network_type = activity_cfg["network_type"]
    base_speed = activity_cfg["speeds"]["normal"]
    metabolic_factor = activity_cfg["metabolic_factor"]

    multi_g = download_street_network(mission.origin, mission.destination, network_type=network_type)
    if multi_g is None or not hasattr(multi_g, "nodes") or len(multi_g.nodes) == 0:
        return {off: [] for off in offsets}

    origin_node = ox.distance.nearest_nodes(multi_g, X=mission.origin.lng, Y=mission.origin.lat)
    dest_node = ox.distance.nearest_nodes(multi_g, X=mission.destination.lng, Y=mission.destination.lat)
    
    routes_by_offset = {}
    for offset in offsets:
        try:
            G = assign_thermal_weights_and_collapse(
                multi_g,
                offset,
                provider,
                base_speed_mps=base_speed,
                metabolic_factor=metabolic_factor
            )
            routes = get_candidate_routes(G, origin_node, dest_node)
            routes_by_offset[offset] = routes
        except Exception as e:
            logger.warning(f"Fallback routing failed for offset {offset} ({network_type}): {e}")
            routes_by_offset[offset] = []
            
    return routes_by_offset


async def optimize_mission(mission: Mission, provider) -> Dict[str, Any]:
    planning_mode = getattr(mission, "planning_mode", "instant")
    if planning_mode == "instant":
        offsets = [0]
    else:
        offsets = [0, 15, 30, 45, 60]

    activity_cfg = get_activity_config(mission.activity)

    await provider.prepare_environment(mission.origin, mission.destination, offsets)

    loop = asyncio.get_event_loop()
    
    try:
        routes_by_offset = await loop.run_in_executor(
            _executor, _compute_routes_blocking, mission, offsets, provider, activity_cfg
        )
    except Exception as e:
        logger.error(f"Graph computation error: {e}")
        routes_by_offset = {off: [] for off in offsets}

    baseline_routes = routes_by_offset.get(0, [])

    if not baseline_routes:
        return {
            "decision": "NO ROUTE",
            "planning_mode": planning_mode,
            "wait_minutes": 0,
            "recommended_action": None,
            "comparison": None,
            "thermal_reduction_percent": None,
            "routes": None,
            "route_options": [],
            "details": f"No accessible {mission.activity} route found between the selected points.",
            "explanation": f"No accessible route was found for {mission.activity} between those two points."
        }

    actions = generate_actions(baseline_routes, departure_offsets=offsets)
    simulated_actions = [simulate_action(a, mission, routes_by_offset, activity_cfg) for a in actions]
    feasible_actions = [a for a in simulated_actions if a.feasible]

    fastest_now_action = next(
        (a for a in simulated_actions
         if a.route_id == "fastest" and a.departure_offset_minutes == 0 and a.pace == "normal"),
        None
    )

    fastest_tei = 0.0
    if fastest_now_action and fastest_now_action.travel_time_minutes and fastest_now_action.travel_time_minutes > 0:
        fastest_tei = (fastest_now_action.thermal_load / (fastest_now_action.travel_time_minutes * 60)) * 100

    if feasible_actions:
        best_action = min(feasible_actions, key=lambda a: a.thermal_load)
        decision = "GO"
        if best_action.route_id != "fastest" and best_action.departure_offset_minutes == 0:
            decision = "REROUTE"
        elif best_action.departure_offset_minutes > 0:
            decision = "WAIT_AND_REROUTE" if best_action.route_id != "fastest" else "WAIT"
    else:
        best_action = min(simulated_actions, key=lambda a: a.thermal_load) if simulated_actions else None
        decision = "EXTENDED JOURNEY"

    if not best_action:
        return {
            "decision": "NO ROUTE",
            "planning_mode": planning_mode,
            "wait_minutes": 0,
            "recommended_action": None,
            "comparison": None,
            "thermal_reduction_percent": None,
            "routes": None,
            "route_options": [],
            "details": f"No accessible {mission.activity} route found between the selected points.",
            "explanation": f"No accessible route was found for {mission.activity} between those two points."
        }

    best_tei = 0.0
    if best_action.travel_time_minutes and best_action.travel_time_minutes > 0:
        best_tei = (best_action.thermal_load / (best_action.travel_time_minutes * 60)) * 100

    reduction = 0.0
    if fastest_tei > 0:
        reduction = ((fastest_tei - best_tei) / fastest_tei) * 100

    fastest_now_route = next((r for r in baseline_routes if r["id"] == "fastest"), None)
    best_offset_routes = routes_by_offset.get(best_action.departure_offset_minutes, [])
    best_route = next((r for r in best_offset_routes if r["id"] == best_action.route_id), None)

    route_options = []
    for r in baseline_routes:
        r_id = r["id"]
        sim_a = next(
            (a for a in simulated_actions
             if a.route_id == r_id and a.departure_offset_minutes == best_action.departure_offset_minutes and a.pace == mission.pace),
            None
        )
        if not sim_a:
            sim_a = next(
                (a for a in simulated_actions
                 if a.route_id == r_id and a.departure_offset_minutes == 0 and a.pace == "normal"),
                None
            )

        r_travel = round(float(sim_a.travel_time_minutes), 1) if sim_a else round(float(r.get("travel_time", r.get("walk_time", 0.0))) / 60.0, 1)
        r_tei = round((float(sim_a.thermal_load) / (sim_a.travel_time_minutes * 60)) * 100, 1) if (sim_a and sim_a.travel_time_minutes > 0) else round(float(fastest_tei), 1)
        r_red = round(((fastest_tei - r_tei) / fastest_tei) * 100, 1) if fastest_tei > 0 else 0.0

        is_best = (r_id == best_action.route_id)
        route_options.append({
            "id": r_id,
            "name": r.get("name", "CoolPath Route" if is_best else f"Option {r_id}"),
            "tag": "❄️ Recommended" if is_best else r.get("tag", "Alternative"),
            "travel_minutes": r_travel,
            "avg_temp_c": float(r.get("avg_temp_c", 32.0)),
            "thermal_exposure": r_tei,
            "thermal_reduction_percent": r_red,
            "coordinates": r.get("geometry", []),
            "geometry_temps": r.get("geometry_temps", []),
            "explanation": r.get("explanation", ""),
            "is_recommended": is_best
        })

    route_options.sort(key=lambda x: (not x["is_recommended"], x["thermal_exposure"]))

    # Optimal Departure Time string
    opt_departure_dt = mission.departure_time + timedelta(minutes=int(best_action.departure_offset_minutes))
    optimal_departure_str = opt_departure_dt.strftime("%I:%M %p").lstrip("0")

    # Environmental Summary
    env_summary = provider.get_environmental_summary() if hasattr(provider, "get_environmental_summary") else {}

    from app.explanation.llm import generate_explanation
    structured_facts = {
        "decision": decision,
        "planning_mode": planning_mode,
        "wait_minutes": best_action.departure_offset_minutes,
        "thermal_reduction_percent": round(reduction, 1),
        "activity": mission.activity
    }

    rec_action = best_action.dict() if hasattr(best_action, "dict") else best_action.model_dump()
    if rec_action.get("arrival_time"):
        rec_action["arrival_time"] = rec_action["arrival_time"].isoformat()
    if rec_action.get("thermal_load") is not None:
        rec_action["thermal_load"] = float(rec_action["thermal_load"])
    if rec_action.get("travel_time_minutes") is not None:
        rec_action["travel_time_minutes"] = float(rec_action["travel_time_minutes"])

    fastest_travel = float(fastest_now_action.travel_time_minutes) if fastest_now_action and fastest_now_action.travel_time_minutes else 0.0
    rec_travel = float(best_action.travel_time_minutes) if best_action.travel_time_minutes else 0.0

    return {
        "decision": str(decision),
        "planning_mode": planning_mode,
        "wait_minutes": int(best_action.departure_offset_minutes),
        "optimal_departure_time": optimal_departure_str,
        "activity": str(mission.activity),
        "recommended_action": rec_action,
        "comparison": {
            "fastest": {
                "travel_minutes": round(fastest_travel, 1),
                "thermal_exposure": round(float(fastest_tei), 1)
            },
            "recommended": {
                "travel_minutes": round(rec_travel, 1),
                "thermal_exposure": round(float(best_tei), 1)
            }
        },
        "thermal_reduction_percent": round(float(reduction), 1),
        "routes": {
            "fastest": fastest_now_route["geometry"] if (fastest_now_route and "geometry" in fastest_now_route) else [],
            "recommended": best_route["geometry"] if (best_route and "geometry" in best_route) else []
        },
        "route_options": route_options,
        "env_summary": env_summary,
        "explanation": generate_explanation(structured_facts)
    }
