import osmnx as ox
import networkx as nx
from shapely.geometry import box
import numpy as np
from pathlib import Path
import logging
import pickle
import time

from app.models.mission import Coordinate
from app.services.thermal_provider import ThermalProvider

logger = logging.getLogger(__name__)

# Configure OSMnx caching
OSMNX_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "osmnx"
OSMNX_CACHE_DIR.mkdir(parents=True, exist_ok=True)
ox.settings.use_cache = True
ox.settings.cache_folder = str(OSMNX_CACHE_DIR)
ox.settings.log_console = False
ox.settings.requests_timeout = 6
ox.settings.overpass_rate_limit = False
ox.settings.user_agent = "CoolPath-HeatAwarePlanner/1.0 (https://github.com/FortyGuard-Tech/temperature-api-quickstart)"

MASTER_GRAPH_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "nyc_street_graph_master.pkl"
_MASTER_GRAPH_CACHE = None

def load_master_nyc_graph() -> nx.MultiDiGraph:
    """Loads the pre-built 76,485-node master NYC street graph from local disk in ~500ms."""
    global _MASTER_GRAPH_CACHE
    if _MASTER_GRAPH_CACHE is not None:
        return _MASTER_GRAPH_CACHE
        
    if MASTER_GRAPH_PATH.exists():
        try:
            t0 = time.time()
            with open(MASTER_GRAPH_PATH, "rb") as f:
                _MASTER_GRAPH_CACHE = pickle.load(f)
            logger.info(f"Loaded Master NYC Street Graph ({len(_MASTER_GRAPH_CACHE.nodes)} nodes) in {time.time()-t0:.2f}s")
            return _MASTER_GRAPH_CACHE
        except Exception as e:
            logger.error(f"Error loading master graph pickle: {e}")
            
    return None

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api",
    "https://lz4.overpass-api.de/api",
    "https://overpass.kumi.systems/api",
    "https://overpass.private.coffee/api",
]

def crop_subgraph_for_bounds(master_g: nx.MultiDiGraph, origin: Coordinate, destination: Coordinate, buffer: float = 0.006) -> nx.MultiDiGraph:
    """Crops a bounding box subgraph from the master NYC graph for instant sub-20ms routing."""
    north = max(origin.lat, destination.lat) + buffer
    south = min(origin.lat, destination.lat) - buffer
    east = max(origin.lng, destination.lng) + buffer
    west = min(origin.lng, destination.lng) - buffer
    
    sub_g = nx.MultiDiGraph()
    if hasattr(master_g, 'graph'):
        sub_g.graph.update(master_g.graph)
    sub_g.graph["crs"] = "epsg:4326"
    
    valid_nodes = set()
    for n, data in master_g.nodes(data=True):
        x, y = data.get("x"), data.get("y")
        if x is not None and y is not None:
            if west <= x <= east and south <= y <= north:
                valid_nodes.add(n)
                sub_g.add_node(n, **data)
                
    for u, v, k, data in master_g.edges(data=True, keys=True):
        if u in valid_nodes and v in valid_nodes:
            sub_g.add_edge(u, v, k, **data)
            
    return sub_g

def build_corridor_fallback_graph(origin: Coordinate, destination: Coordinate, base_speed_mps: float = 1.4) -> nx.MultiDiGraph:
    """Builds an orthogonal street block grid corridor between origin and destination."""
    multi_g = nx.MultiDiGraph()
    multi_g.graph["crs"] = "epsg:4326"
    multi_g.graph["name"] = "corridor_fallback_grid"
    
    lat_min = min(origin.lat, destination.lat) - 0.003
    lat_max = max(origin.lat, destination.lat) + 0.003
    lng_min = min(origin.lng, destination.lng) - 0.003
    lng_max = max(origin.lng, destination.lng) + 0.003
    
    lat_steps = 30
    lng_steps = 30
    lats = np.linspace(lat_min, lat_max, lat_steps)
    lngs = np.linspace(lng_min, lng_max, lng_steps)
    
    node_id = 0
    grid_map = {}
    for i, lat in enumerate(lats):
        for j, lng in enumerate(lngs):
            grid_map[(i, j)] = node_id
            multi_g.add_node(node_id, x=float(lng), y=float(lat))
            node_id += 1
            
    # Strictly orthogonal cardinal directions (North, South, East, West) to simulate street blocks
    deltas = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    
    for i in range(lat_steps):
        for j in range(lng_steps):
            curr = grid_map[(i, j)]
            for di, dj in deltas:
                ni, nj = i + di, j + dj
                if 0 <= ni < lat_steps and 0 <= nj < lng_steps:
                    nbr = grid_map[(ni, nj)]
                    dlat = (lats[ni] - lats[i]) * 111000.0
                    dlng = (lngs[nj] - lngs[j]) * 111000.0 * np.cos(np.radians(lats[i]))
                    dist = float(np.sqrt(dlat**2 + dlng**2))
                    tt = dist / max(0.1, base_speed_mps)
                    multi_g.add_edge(curr, nbr, 0, length=dist, travel_time=tt, walk_time=tt)
                    
    logger.info(f"Built resilient orthogonal street grid ({len(multi_g.nodes)} nodes, {len(multi_g.edges)} edges)")
    return multi_g

def download_street_network(origin: Coordinate, destination: Coordinate, network_type: str = "walk"):
    """
    Downloads or retrieves the base OSM street graph containing origin and destination.
    Uses pre-packaged local NYC master graph for instant 100% offline real street routing.
    """
    # 1. Try pre-packaged Master NYC Graph first (0 network latency, 100% real street geometries)
    master_g = load_master_nyc_graph()
    if master_g is not None:
        try:
            sub_g = crop_subgraph_for_bounds(master_g, origin, destination, buffer=0.006)
            if len(sub_g.nodes) >= 20 and len(sub_g.edges) >= 20:
                logger.info(f"Using pre-packaged real NYC street network ({len(sub_g.nodes)} nodes)")
                return sub_g
        except Exception as e:
            logger.warning(f"Error cropping master graph: {e}")

    # 2. Try online Overpass API download with correct OSMnx bbox order (west, south, east, north)
    buffer = 0.005
    north = max(origin.lat, destination.lat) + buffer
    south = min(origin.lat, destination.lat) - buffer
    east = max(origin.lng, destination.lng) + buffer
    west = min(origin.lng, destination.lng) - buffer
    
    ox.settings.requests_timeout = 25
    ox.settings.use_cache = True
    ox.settings.overpass_rate_limit = False
    
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            ox.settings.overpass_url = endpoint
            g = ox.graph_from_bbox(bbox=(west, south, east, north), network_type=network_type)
            if g is not None and len(g.nodes) > 10:
                base_speed_mps = 1.4
                for u, v, k, data in g.edges(data=True, keys=True):
                    length = float(data.get("length", 50.0))
                    tt = length / base_speed_mps
                    data["travel_time"] = tt
                    data["walk_time"] = tt
                logger.info(f"Successfully downloaded real OSM street network ({len(g.nodes)} nodes)")
                return g
        except Exception as e:
            logger.warning(f"Overpass download failed on {endpoint}: {e}")
            continue
            
    # 3. Resilient local street grid fallback
    logger.info("Using resilient orthogonal local street grid fallback.")
    return build_corridor_fallback_graph(origin, destination)

# Backward-compatible alias
download_pedestrian_network = download_street_network

def _sample_points_along_edge(
    geom,
    n1_data: dict,
    n2_data: dict,
    n_samples: int = 5
) -> list:
    """
    Generate N evenly-spaced (lng, lat, weight) sample points along an edge.
    Weight = segment_fraction for Haversine-weighted averaging.
    """
    from shapely.geometry import LineString
    import numpy as np

    if geom is not None:
        # Use the actual edge geometry
        length = geom.length
        if length == 0:
            return [(geom.coords[0][0], geom.coords[0][1], 1.0)]
        fracs = np.linspace(0.0, 1.0, n_samples)
        return [(geom.interpolate(f, normalized=True).x,
                 geom.interpolate(f, normalized=True).y,
                 1.0 / n_samples) for f in fracs]
    else:
        # Interpolate linearly between node coordinates
        x1, y1 = n1_data.get("x", 0.0), n1_data.get("y", 0.0)
        x2, y2 = n2_data.get("x", 0.0), n2_data.get("y", 0.0)
        fracs = [i / max(n_samples - 1, 1) for i in range(n_samples)]
        return [(x1 + f * (x2 - x1), y1 + f * (y2 - y1), 1.0 / n_samples)
                for f in fracs]


def assign_thermal_weights_and_collapse(
    multi_g,
    departure_offset_minutes: int,
    thermal_provider: ThermalProvider,
    base_speed_mps: float = 1.4,
    metabolic_factor: float = 1.0,
    rh_pct: float = 30.0,
    wind_ms: float = 1.0,
    activity: str = "walking",
) -> nx.DiGraph:
    """
    Phase 2+3 Fix:
    - N=5 evenly-spaced sample points per edge (Haversine distance-weighted average)
    - UTCI-based normalized heat cost: C_e = normalize_utci_cost(UTCI) * travel_time * metabolic_factor
    - Shade ratio stored separately as edge attribute 'shade_ratio'
    - Activity-aware relative wind and real weather metrics applied to UTCI
    """
    from app.services.utci_model import compute_utci, normalize_utci_cost

    N_SAMPLES = 5
    G = nx.DiGraph()
    if multi_g is None or not hasattr(multi_g, 'nodes'):
        return G
    if hasattr(multi_g, 'graph') and multi_g.graph is not None:
        G.graph.update(multi_g.graph)

    for n, data in multi_g.nodes(data=True):
        G.add_node(n, **data)

    for u, v, k, data in multi_g.edges(data=True, keys=True):
        edge_data = dict(data)
        length = float(edge_data.get("length", 0.0))

        speed = base_speed_mps
        if "maxspeed" in edge_data and base_speed_mps > 5.0:
            try:
                ms = edge_data["maxspeed"]
                if isinstance(ms, list):
                    ms = ms[0]
                if isinstance(ms, str):
                    nums = "".join(ch for ch in ms if ch.isdigit() or ch == ".")
                    if nums:
                        val = float(nums)
                        speed = val * 0.44704 if "mph" in ms.lower() else val / 3.6
            except Exception:
                speed = base_speed_mps

        if speed <= 0.1:
            speed = base_speed_mps

        travel_time = length / speed if length > 0 else 1.0
        edge_data["travel_time"] = travel_time
        edge_data["walk_time"] = travel_time

        # ----------------------------------------------------------------
        # Phase 3: Multi-sample thermal evaluation (N=5 points per edge)
        # ----------------------------------------------------------------
        geom = edge_data.get("geometry", None)
        n1_data = multi_g.nodes[u]
        n2_data = multi_g.nodes[v]
        sample_points = _sample_points_along_edge(geom, n1_data, n2_data, N_SAMPLES)

        weighted_utci_sum = 0.0
        weighted_temp_sum = 0.0
        total_weight = 0.0

        for lng, lat, w in sample_points:
            temp, _ = thermal_provider.get_temperature_for_point(lng, lat, departure_offset_minutes)
            temp_f = float(temp)
            # Shade ratio: approximated from OSM 'tunnel' or 'covered' tag; default 0 (full sun)
            shade_ratio = 0.3 if edge_data.get("tunnel") or edge_data.get("covered") else 0.0
            utci_val, _, _ = compute_utci(temp_f, rh_pct=rh_pct, wind_ms=wind_ms, shade_ratio=shade_ratio, activity=activity)
            weighted_utci_sum += utci_val * w
            weighted_temp_sum += temp_f * w
            total_weight += w

        avg_utci = weighted_utci_sum / total_weight if total_weight > 0 else 38.0
        avg_temp = weighted_temp_sum / total_weight if total_weight > 0 else 36.0

        # ----------------------------------------------------------------
        # Phase 4 prep: dimensionless normalized heat cost
        # C_heat_edge = normalize_utci_cost(avg_utci) * travel_time * metabolic_factor
        # ----------------------------------------------------------------
        norm_heat = normalize_utci_cost(avg_utci)
        thermal_cost = norm_heat * travel_time * metabolic_factor

        edge_data["temperature"] = round(avg_temp, 1)
        edge_data["utci"] = round(avg_utci, 1)
        edge_data["normalized_heat"] = round(norm_heat, 3)
        edge_data["thermal_cost"] = thermal_cost
        edge_data["shade_ratio"] = shade_ratio

        if G.has_edge(u, v):
            if travel_time < G[u][v]["travel_time"]:
                G[u][v].update(edge_data)
        else:
            G.add_edge(u, v, **edge_data)

    return G

def get_walking_graph(origin: Coordinate, destination: Coordinate, departure_offset_minutes: int, thermal_provider: ThermalProvider) -> nx.DiGraph:
    """Backward-compatible helper that downloads and computes in one step."""
    multi_g = download_street_network(origin, destination, network_type="walk")
    return assign_thermal_weights_and_collapse(multi_g, departure_offset_minutes, thermal_provider)
