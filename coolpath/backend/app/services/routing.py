import math
import urllib.request
import json
import ssl
import logging
from typing import List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import networkx as nx

from app.models.mission import Coordinate
from app.config import MAPBOX_TOKEN

logger = logging.getLogger(__name__)

# SSL context for robust HTTPS requests
_SSL_CTX = ssl._create_unverified_context()

# Thread pool for parallel Mapbox API calls
_MAPBOX_POOL = ThreadPoolExecutor(max_workers=4)

# Geometry sampling: evaluate thermal cost at every Nth point for long routes
_THERMAL_SAMPLE_MAX_POINTS = 60

def _fetch_mapbox_directions(waypoints: List[Tuple[float, float]], profile: str = "walking") -> Dict[str, Any]:
    """
    Fetches real-street turn-by-turn road geometries from Mapbox Directions API.
    This serves as the primary source of truth for real-world connectivity,
    following actual avenues, streets, pedestrian crossings, and park paths.
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
    Thermal-Time Multi-Objective Route Optimizer.
    Generates distinct, real-street candidate routes via Mapbox Directions API,
    evaluates UTCI-based thermal cost per route, applies hard 1.25x detour cap.

    Routes generated:
      1. Direct Fastest (⚡ Fastest)
      2. CoolPath Recommended (❄️ Coolest) — lateral corridor
      3. Balanced Route (⚖️ Balanced) — opposite lateral corridor
      4. Side-Street Corridor (🌳 Shaded) — wider lateral offset
    """
    from app.services.utci_model import compute_utci, normalize_utci_cost, utci_stress_category

    DETOUR_CAP = 1.25   # Hard limit: coolest route cannot be more than 25% slower than fastest

    profile_map = {
        "walking": "walking",
        "running": "walking",
        "biking": "cycling",
        "driving": "driving"
    }
    mb_profile = profile_map.get(str(activity or "walking").lower(), "walking")
    metabolic_factor = 1.8 if activity == "running" else (1.2 if activity == "biking" else 1.0)

    routes_raw = []

    # Precompute lateral waypoints for corridor routes
    mid_lng = (origin.lng + destination.lng) / 2.0
    mid_lat = (origin.lat + destination.lat) / 2.0
    d_lng = destination.lng - origin.lng
    d_lat = destination.lat - origin.lat
    length = math.sqrt(d_lng**2 + d_lat**2) or 0.001

    corridor_configs = [
        (0.0035, "❄️ Coolest", "CoolPath Recommended"),
        (-0.0035, "⚖️ Balanced", "Balanced Route"),
        (0.0060, "🌳 Shaded Corridor", "Side-Street Corridor"),
    ]

    # Build all waypoint sets for parallel fetch
    fetch_jobs = []
    # Job 0: Direct fastest
    fetch_jobs.append(("fastest", [(origin.lng, origin.lat), (destination.lng, destination.lat)]))
    # Jobs 1-3: Corridor alternatives
    for offset_scale, tag, name in corridor_configs:
        perp_lat = (-d_lng / length) * offset_scale
        perp_lng = (d_lat / length) * offset_scale
        wp = (mid_lng + perp_lng, mid_lat + perp_lat)
        fetch_jobs.append((name, [(origin.lng, origin.lat), wp, (destination.lng, destination.lat)]))

    # Fetch all routes in parallel (4 concurrent Mapbox API calls)
    fetch_results = {}
    futures = {}
    for job_key, waypoints in fetch_jobs:
        future = _MAPBOX_POOL.submit(_fetch_mapbox_directions, waypoints, mb_profile)
        futures[future] = job_key

    for future in as_completed(futures):
        job_key = futures[future]
        try:
            fetch_results[job_key] = future.result()
        except Exception:
            fetch_results[job_key] = None

    # Process direct route first
    direct = fetch_results.get("fastest")
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

    fastest_duration = routes_raw[0]["duration"] if routes_raw else None

    # Process corridor alternatives
    for offset_scale, tag, name in corridor_configs:
        alt = fetch_results.get(name)
        if alt and alt.get("coordinates") and len(alt["coordinates"]) >= 2:
            if fastest_duration and alt["duration"] > fastest_duration * DETOUR_CAP:
                logger.info(f"[DETOUR CAP] {name} rejected: {alt['duration']:.0f}s > {fastest_duration * DETOUR_CAP:.0f}s cap")
                continue

            is_dup = any(
                len(r["coordinates"]) == len(alt["coordinates"]) and
                r["coordinates"][len(alt["coordinates"]) // 2] == alt["coordinates"][len(alt["coordinates"]) // 2]
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

    # -----------------------------------------------------------------------
    # Phase 2: UTCI-based thermal cost for every route
    # Phase 4: Dimensionless C_heat = E_route / E_baseline (fastest route exposure)
    # -----------------------------------------------------------------------
    processed_routes = []
    route_utci_totals: Dict[str, float] = {}

    for r in routes_raw:
        coords = r["coordinates"]
        dur = r["duration"]

        temps = []
        utci_vals = []
        geometry_temps = []

        # Adaptive sampling: for long routes, sample evenly spaced points
        # to avoid O(n) thermal lookups on routes with 200+ geometry points
        num_coords = len(coords)
        if num_coords > _THERMAL_SAMPLE_MAX_POINTS:
            step = max(1, num_coords // _THERMAL_SAMPLE_MAX_POINTS)
            sample_indices = list(range(0, num_coords, step))
            if sample_indices[-1] != num_coords - 1:
                sample_indices.append(num_coords - 1)
        else:
            sample_indices = list(range(num_coords))

        sampled_temps = []
        sampled_utcis = []

        for idx in sample_indices:
            pt = coords[idx]
            try:
                temp, _ = provider.get_temperature_for_point(pt[0], pt[1], offset_minutes)
                temp_f = float(temp)
                utci_c, shade, src = compute_utci(temp_f, rh_pct=30.0, wind_ms=1.0, shade_ratio=0.0, activity=activity)
                sampled_temps.append(temp_f)
                sampled_utcis.append(utci_c)
            except Exception:
                sampled_temps.append(31.5)
                sampled_utcis.append(36.0)

        # Interpolate for full geometry_temps output (needed for map rendering)
        avg_sampled_temp = sum(sampled_temps) / len(sampled_temps) if sampled_temps else 31.5
        sample_map = {}
        for i, idx in enumerate(sample_indices):
            sample_map[idx] = sampled_temps[i]

        for i, pt in enumerate(coords):
            if i in sample_map:
                t = sample_map[i]
            else:
                t = avg_sampled_temp
            geometry_temps.append([float(pt[0]), float(pt[1]), t])

        temps = sampled_temps
        utci_vals = sampled_utcis

        avg_temp = round(sum(temps) / len(temps), 1) if temps else 31.5
        avg_utci = round(sum(utci_vals) / len(utci_vals), 1) if utci_vals else 36.0
        norm_heat = normalize_utci_cost(avg_utci)

        # Raw thermal cost for comparing routes (will normalize in Phase 4 step below)
        raw_thermal_cost = norm_heat * dur * metabolic_factor
        route_utci_totals[r["id"]] = raw_thermal_cost

        processed_routes.append({
            "id": r["id"],
            "name": r["name"],
            "tag": r["tag"],
            "nodes": list(range(len(coords))),
            "geometry": coords,
            "geometry_temps": geometry_temps,
            "travel_time": dur,
            "walk_time": dur,
            "thermal_cost": raw_thermal_cost,
            "avg_temp_c": avg_temp,
            "avg_utci_c": avg_utci,
            "utci_stress": utci_stress_category(avg_utci),
            "normalized_heat": round(norm_heat, 3),
            "is_fastest": r["is_fastest"],
            "explanation": f"{r['name']}: avg UTCI {avg_utci}°C ({utci_stress_category(avg_utci).replace('_', ' ')}), {dur/60:.1f} min."
        })

    # Phase 4: Normalize C_heat = E_route / max(E_fastest, EPSILON) (dimensionless)
    EPSILON = 1e-3
    fastest_thermal = route_utci_totals.get("fastest", 0.0)
    ref_thermal = max(float(fastest_thermal), EPSILON)
    for r in processed_routes:
        r["c_heat"] = round(r["thermal_cost"] / ref_thermal, 3)

    return processed_routes



def get_candidate_routes(G: nx.DiGraph, origin_node, dest_node, max_alternatives=4) -> List[Dict[str, Any]]:
    """
    Graph-based Thermal-Time Multi-Objective Route Generation.
    
    Generates alternative routes by re-weighting graph edges with different
    thermal alpha values and running Dijkstra/NetworkX shortest-path per alpha.
    Every edge is guaranteed to exist in the actual OSM/NetworkX graph,
    serving as the local graph-based source of truth when Mapbox is unavailable.
    
    Alpha values control the tradeoff:
      α=0:   Pure fastest (time-only)
      α=0.5: Balanced (time + heat)
      α=0.75: Heat-biased
      α=1.0: Pure coolest (heat-only, subject to 1.25x detour cap)
    """
    from app.services.utci_model import normalize_utci_cost, utci_stress_category

    DETOUR_CAP = 1.25  # Coolest route cannot be more than 25% slower than fastest

    if not G or len(G.nodes) == 0:
        return []

    # 1. Fastest route baseline (α=0 — pure travel_time weight)
    try:
        fastest_nodes = nx.shortest_path(G, origin_node, dest_node, weight="travel_time")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []

    def get_route_metrics(nodes):
        total_time = 0.0
        total_utci_weighted = 0.0
        temps = []
        utci_vals = []
        for u, v in zip(nodes[:-1], nodes[1:]):
            if not G.has_edge(u, v):
                continue
            edge = G[u][v]
            t = float(edge.get("travel_time", edge.get("walk_time", 1.0)))
            total_time += t
            utci = float(edge.get("utci", 36.0))
            total_utci_weighted += utci * t
            if "temperature" in edge:
                try:
                    temps.append(float(edge["temperature"]))
                except (ValueError, TypeError):
                    pass
            if "utci" in edge:
                try:
                    utci_vals.append(float(edge["utci"]))
                except (ValueError, TypeError):
                    pass
        avg_temp = round(sum(temps) / len(temps), 1) if temps else 32.0
        avg_utci = round(sum(utci_vals) / len(utci_vals), 1) if utci_vals else 36.0
        return total_time, avg_temp, avg_utci

    def path_key(path):
        return tuple(path)

    def make_route_dict(r_id: str, name: str, tag: str, nodes: list,
                        is_fastest: bool) -> Dict[str, Any]:
        coords = [[G.nodes[n]["x"], G.nodes[n]["y"]] for n in nodes if n in G.nodes]
        geometry_temps = []
        for n in nodes:
            if n not in G.nodes:
                continue
            x, y = G.nodes[n]["x"], G.nodes[n]["y"]
            temp = 32.0
            # Find edge temp from predecessor if possible
            geometry_temps.append([float(x), float(y), temp])
        total_time, avg_temp, avg_utci = get_route_metrics(nodes)
        norm_heat = normalize_utci_cost(avg_utci)
        thermal_cost = norm_heat * total_time
        return {
            "id": r_id,
            "name": name,
            "tag": tag,
            "nodes": nodes,
            "geometry": coords,
            "geometry_temps": geometry_temps,
            "travel_time": total_time,
            "walk_time": total_time,
            "thermal_cost": thermal_cost,
            "avg_temp_c": avg_temp,
            "avg_utci_c": avg_utci,
            "utci_stress": utci_stress_category(avg_utci),
            "normalized_heat": round(norm_heat, 3),
            "is_fastest": is_fastest,
            "explanation": f"{name}: avg UTCI {avg_utci}°C, {total_time/60:.1f} min."
        }

    routes = []
    seen_paths = {path_key(fastest_nodes)}

    f_time, f_avg_temp, f_avg_utci = get_route_metrics(fastest_nodes)
    fastest_route = make_route_dict("fastest", "Direct Fastest", "⚡ Fastest", fastest_nodes, True)
    fastest_route["travel_time"] = f_time
    fastest_route["avg_temp_c"] = f_avg_temp
    fastest_route["avg_utci_c"] = f_avg_utci
    routes.append(fastest_route)

    max_allowed_time = f_time * DETOUR_CAP

    # Candidate 0: Direct Fastest (α=0.0) is added at index 0 above.
    # Candidate 1–3: Thermally-swept alternatives (α=0.50, 0.65, 0.85)
    ALPHA_CONFIGS = [
        (0.50, "⚖️ Balanced", "Balanced Route"),
        (0.65, "🌿 Shaded Option", "Shaded Alternative"),
        (0.85, "❄️ Coolest", "CoolPath Recommended"),
    ]

    def blend_weight(alpha):
        def _weight(u, v, d):
            t = d.get("travel_time", d.get("walk_time", 1.0))
            heat = d.get("thermal_cost", 0.0)
            # Normalize time by f_time so both are dimensionless
            c_time = float(t) / max(f_time, 1.0)
            # thermal_cost is already normalize_utci_cost * travel_time
            # For routing weight, use the normalized_heat directly
            c_heat = float(d.get("normalized_heat", 0.5))
            return (1.0 - alpha) * c_time + alpha * c_heat
        return _weight

    for alpha, tag, name in ALPHA_CONFIGS:
        if len(routes) >= max_alternatives:
            break
        try:
            path = nx.shortest_path(G, origin_node, dest_node, weight=blend_weight(alpha))
            pk = path_key(path)
            if pk in seen_paths:
                continue
            p_time, p_avg_temp, p_avg_utci = get_route_metrics(path)
            if p_time > max_allowed_time:
                logger.info(f"[DETOUR CAP] {name} (α={alpha}): {p_time:.0f}s > cap {max_allowed_time:.0f}s — skipped")
                continue
            r = make_route_dict(f"route_{len(routes)}", name, tag, path, False)
            routes.append(r)
            seen_paths.add(pk)
        except Exception as e:
            logger.debug(f"[k-shortest] α={alpha} failed: {e}")
            continue

    # Phase 4: Normalize C_heat = E_route / max(E_fastest, EPSILON) (dimensionless)
    EPSILON = 1e-3
    fastest_thermal = routes[0]["thermal_cost"] if routes else 0.0
    ref_thermal = max(float(fastest_thermal), EPSILON)
    for r in routes:
        r["c_heat"] = round(r["thermal_cost"] / ref_thermal, 3)

    return routes

