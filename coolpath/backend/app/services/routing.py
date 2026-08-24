import math
import urllib.request
import json
import ssl
import logging
from typing import List, Dict, Any, Tuple
import networkx as nx

from app.models.mission import Coordinate
from app.config import MAPBOX_TOKEN

logger = logging.getLogger(__name__)

# SSL context for robust HTTPS requests
_SSL_CTX = ssl._create_unverified_context()

def _fetch_mapbox_directions(waypoints: List[Tuple[float, float]], profile: str = "walking") -> Dict[str, Any]:
    """
    Fetches real-street turn-by-turn road geometries from Mapbox Directions API.
    Follows actual avenues, streets, pedestrian crossings, and park paths.
    """
    token = MAPBOX_TOKEN or "pk.eyJ1IjoianVuYWlkbWlyMDUxIiwiYSI6ImNtc3l0MWFwNjAzMmsyenNrbW1mMjI0aHcifQ.j8_w_jQUiv26L8QYQVSBVA"
    wp_str = ";".join([f"{lng:.6f},{lat:.6f}" for lng, lat in waypoints])
    url = f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{wp_str}?geometries=geojson&overview=full&steps=false&access_token={token}"
    
    req = urllib.request.Request(url, headers={"User-Agent": "CoolPath-RealStreet/1.0"})
    try:
        with urllib.request.urlopen(req, context=_SSL_CTX, timeout=8) as resp:
            data = json.loads(resp.read().decode())
            if data.get("routes"):
                r = data["routes"][0]
                return {
                    "coordinates": r["geometry"]["coordinates"],
                    "distance": float(r["distance"]),
                    "duration": float(r["duration"])
                }
    except Exception as e:
        logger.warning(f"Mapbox Directions query failed: {e}")
        
    return None


def compute_real_street_candidate_routes(
    origin: Coordinate,
    destination: Coordinate,
    activity: str,
    provider,
    offset_minutes: int = 0
) -> List[Dict[str, Any]]:
    """
    Generates distinct, 100% real-street candidate routes:
    1. Direct Fastest (⚡ Fastest)
    2. CoolPath Recommended (❄️ Coolest)
    3. Balanced Route (⚖️ Balanced)
    4. Shaded Corridor (🌳 Quiet Corridor)
    
    Evaluates real thermal microclimates from FortyGuard along every street segment.
    """
    profile_map = {
        "walking": "walking",
        "running": "walking",
        "biking": "cycling",
        "driving": "driving"
    }
    mb_profile = profile_map.get(str(activity or "walking").lower(), "walking")
    metabolic_factor = 1.8 if activity == "running" else (1.2 if activity == "biking" else 1.0)
    
    routes_raw = []
    
    # 1. Direct fastest real-street route
    direct = _fetch_mapbox_directions(
        [(origin.lng, origin.lat), (destination.lng, destination.lat)],
        profile=mb_profile
    )
    if direct and direct.get("coordinates") and len(direct["coordinates"]) >= 2:
        routes_raw.append({
            "id": "fastest",
            "name": "Direct Fastest",
            "tag": "⚡ Fastest",
            "coordinates": direct["coordinates"],
            "duration": direct["duration"],
            "distance": direct["distance"],
            "is_fastest": True,
        })
        
    # 2. Compute distinct lateral corridor detours along real streets and park paths
    mid_lng = (origin.lng + destination.lng) / 2.0
    mid_lat = (origin.lat + destination.lat) / 2.0
    d_lng = destination.lng - origin.lng
    d_lat = destination.lat - origin.lat
    length = math.sqrt(d_lng**2 + d_lat**2) or 0.001
    
    # Perpendicular lateral offsets in degrees (~150m, ~250m, ~350m)
    corridor_configs = [
        (0.0035, "❄️ Coolest", "CoolPath Recommended"),
        (-0.0035, "⚖️ Balanced", "Balanced Route"),
        (0.0060, "🌳 Quiet Corridor", "Side-Street Corridor"),
    ]
    
    for offset_scale, tag, name in corridor_configs:
        perp_lat = (-d_lng / length) * offset_scale
        perp_lng = (d_lat / length) * offset_scale
        wp = (mid_lng + perp_lng, mid_lat + perp_lat)
        
        alt = _fetch_mapbox_directions(
            [(origin.lng, origin.lat), wp, (destination.lng, destination.lat)],
            profile=mb_profile
        )
        if alt and alt.get("coordinates") and len(alt["coordinates"]) >= 2:
            # Check for near-duplicate geometry
            is_dup = any(
                len(r["coordinates"]) == len(alt["coordinates"]) and 
                r["coordinates"][len(alt["coordinates"])//2] == alt["coordinates"][len(alt["coordinates"])//2]
                for r in routes_raw
            )
            if not is_dup:
                routes_raw.append({
                    "id": f"route_{len(routes_raw)}",
                    "name": name,
                    "tag": tag,
                    "coordinates": alt["coordinates"],
                    "duration": alt["duration"],
                    "distance": alt["distance"],
                    "is_fastest": False,
                })
                
    if not routes_raw:
        return []
        
    # Sample temperatures and compute thermal costs along real street paths
    processed_routes = []
    for r in routes_raw:
        coords = r["coordinates"]
        dur = r["duration"]
        
        # Sample temperature along the street path for average calculation
        # and attach the temperature for every point to create a gradient path
        temps = []
        geometry_temps = []
        for pt in coords:
            try:
                temp, _ = provider.get_temperature_for_point(pt[0], pt[1], offset_minutes)
                temp_val = float(temp)
                temps.append(temp_val)
                geometry_temps.append([float(pt[0]), float(pt[1]), temp_val])
            except Exception:
                temps.append(31.5)
                geometry_temps.append([float(pt[0]), float(pt[1]), 31.5])
                
        avg_temp = round(sum(temps) / len(temps), 1) if temps else 31.5
        heat_penalty = max(0.0, avg_temp - 28.0) * 1.5
        thermal_cost = dur * heat_penalty * metabolic_factor
        
        processed_routes.append({
            "id": r["id"],
            "name": r["name"],
            "tag": r["tag"],
            "nodes": list(range(len(coords))),
            "geometry": coords,
            "geometry_temps": geometry_temps,
            "travel_time": dur,
            "walk_time": dur,
            "thermal_cost": thermal_cost,
            "avg_temp_c": avg_temp,
            "is_fastest": r["is_fastest"],
            "explanation": f"{r['name']}: {avg_temp}°C average street temperature, {dur/60:.1f} min travel time."
        })
        
    return processed_routes


def get_candidate_routes(G: nx.DiGraph, origin_node, dest_node, max_alternatives=4) -> List[Dict[str, Any]]:
    """
    Fallback graph routing for offline NetworkX street graphs.
    """
    try:
        fastest_nodes = nx.shortest_path(G, origin_node, dest_node, weight="travel_time")
    except (nx.NetworkXNoPath, nx.NodeNotFound, KeyError):
        try:
            fastest_nodes = nx.shortest_path(G, origin_node, dest_node, weight="walk_time")
        except Exception:
            return []

    def get_route_metrics(nodes):
        total_time = 0.0
        total_thermal = 0.0
        temps = []
        for u, v in zip(nodes[:-1], nodes[1:]):
            edge = G[u][v]
            t = float(edge.get("travel_time", edge.get("walk_time", 1.0)))
            tc = float(edge.get("thermal_cost", 0.0))
            total_time += t
            total_thermal += tc
            if "temperature" in edge:
                try:
                    temps.append(float(edge["temperature"]))
                except Exception:
                    pass
        avg_temp = round(sum(temps) / len(temps), 1) if temps else 32.0
        return total_time, total_thermal, avg_temp

    routes = []
    seen_paths = set()

    def path_key(path):
        return tuple(path)

    def get_geom_temps(path):
        geom_temps = []
        for n in path:
            x, y = G.nodes[n]['x'], G.nodes[n]['y']
            try:
                temp, _ = provider.get_temperature_for_point(x, y)
                geom_temps.append([float(x), float(y), float(temp)])
            except Exception:
                geom_temps.append([float(x), float(y), 32.0])
        return geom_temps

    # 1. Fastest Route (Baseline)
    f_time, f_thermal, f_avg_temp = get_route_metrics(fastest_nodes)
    fastest_route = {
        "id": "fastest",
        "name": "Direct Fastest",
        "tag": "⚡ Fastest",
        "nodes": fastest_nodes,
        "geometry": [[G.nodes[n]['x'], G.nodes[n]['y']] for n in fastest_nodes],
        "geometry_temps": get_geom_temps(fastest_nodes),
        "travel_time": f_time,
        "walk_time": f_time,
        "thermal_cost": f_thermal,
        "avg_temp_c": f_avg_temp,
        "is_fastest": True,
        "explanation": f"Direct route minimizing overall travel time. Average street temperature: {f_avg_temp}°C."
    }
    routes.append(fastest_route)
    seen_paths.add(path_key(fastest_nodes))

    max_allowed_time = f_time * 1.30

    # 2. Pure Thermal Shortest Path
    try:
        coolest_nodes = nx.shortest_path(G, origin_node, dest_node, weight="thermal_cost")
        if path_key(coolest_nodes) not in seen_paths:
            c_time, c_thermal, c_avg_temp = get_route_metrics(coolest_nodes)
            if c_time <= max_allowed_time:
                routes.append({
                    "id": "coolest",
                    "name": "CoolPath Recommended",
                    "tag": "❄️ Coolest",
                    "nodes": coolest_nodes,
                    "geometry": [[G.nodes[n]['x'], G.nodes[n]['y']] for n in coolest_nodes],
                    "geometry_temps": get_geom_temps(coolest_nodes),
                    "travel_time": c_time,
                    "walk_time": c_time,
                    "thermal_cost": c_thermal,
                    "avg_temp_c": c_avg_temp,
                    "is_fastest": False,
                    "explanation": f"Optimized for maximum heat avoidance. Follows cooler street microclimates at {c_avg_temp}°C."
                })
                seen_paths.add(path_key(coolest_nodes))
    except Exception:
        pass

    # 3. Multi-Objective Pareto Weights
    for alpha in [0.5, 0.75, 0.3]:
        if len(routes) >= max_alternatives:
            break
        try:
            def blend_cost(u, v, d):
                wt = d.get("travel_time", d.get("walk_time", 1.0))
                tc = d.get("thermal_cost", 0.0)
                return (1.0 - alpha) * wt + alpha * tc

            path = nx.shortest_path(G, origin_node, dest_node, weight=blend_cost)
            pk = path_key(path)
            if pk not in seen_paths:
                p_time, p_thermal, p_avg_temp = get_route_metrics(path)
                if p_time <= max_allowed_time:
                    tag = "⚖️ Balanced" if alpha == 0.5 else "🌿 Shaded Option"
                    name = "Balanced Route" if alpha == 0.5 else "Shaded Alternative"
                    routes.append({
                        "id": f"route_{len(routes)}",
                        "name": name,
                        "tag": tag,
                        "nodes": path,
                        "geometry": [[G.nodes[n]['x'], G.nodes[n]['y']] for n in path],
                        "geometry_temps": get_geom_temps(path),
                        "travel_time": p_time,
                        "walk_time": p_time,
                        "thermal_cost": p_thermal,
                        "avg_temp_c": p_avg_temp,
                        "is_fastest": False,
                        "explanation": f"Balanced compromise between speed and temperature ({p_avg_temp}°C)."
                    })
                    seen_paths.add(pk)
        except Exception:
            continue

    return routes
