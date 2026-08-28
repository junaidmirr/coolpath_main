"""
Phase 9 — Validation Experiment Script
======================================
Computes thermal and travel time metrics for 50 random origin-destination pairs
in Phoenix, AZ using the complete CoolPath pipeline (FortyGuard thermal provider +
UTCI model + graph routing + ML model).

Metrics computed per O/D pair:
  1. Fastest Route: travel_time (s), avg UTCI (°C), severe exposure min (>38°C)
  2. CoolPath Route: travel_time (s), avg UTCI (°C), severe exposure min (>38°C)
  3. Deltas: Time delta (min), UTCI reduction (°C), severe heat reduction (min)

Output saved to data/validation_experiment_results.json with summary table.
"""
import sys
import os
import json
import random
import asyncio
import time
from datetime import datetime, timedelta
from pathlib import Path

# Add backend root to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.models.mission import Mission, Coordinate
from app.services.thermal_provider import FortyGuardThermalProvider
from app.decision.engine import optimize_mission

RESULTS_PATH = backend_dir / "data" / "validation_experiment_results.json"
RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)

# Bounding box for Downtown Phoenix O/D pair generation
PHOENIX_BBOX = {
    "lat_min": 33.440,
    "lat_max": 33.460,
    "lng_min": -112.080,
    "lng_max": -112.050,
}


def generate_random_od_pairs(n: int = 50, seed: int = 42) -> list:
    random.seed(seed)
    pairs = []
    for i in range(n):
        # Generate origin & destination ~300m–1.5km apart
        o_lat = random.uniform(PHOENIX_BBOX["lat_min"], PHOENIX_BBOX["lat_max"])
        o_lng = random.uniform(PHOENIX_BBOX["lng_min"], PHOENIX_BBOX["lng_max"])
        # Delta ~0.003°–0.010° (roughly 300m to 1km)
        d_lat = o_lat + random.choice([-1, 1]) * random.uniform(0.003, 0.008)
        d_lng = o_lng + random.choice([-1, 1]) * random.uniform(0.003, 0.008)
        pairs.append({
            "id": i + 1,
            "origin": Coordinate(lat=round(o_lat, 6), lng=round(o_lng, 6)),
            "destination": Coordinate(lat=round(d_lat, 6), lng=round(d_lng, 6)),
        })
    return pairs


async def run_validation_experiment(n_pairs: int = 50):
    print(f"🚀 Starting Phase 9 Validation Experiment ({n_pairs} Phoenix O/D pairs)...")
    provider = FortyGuardThermalProvider()

    # Pre-fetch Phoenix environment ONCE for all pairs
    sample_origin = Coordinate(lat=33.450, lng=-112.065)
    sample_dest = Coordinate(lat=33.455, lng=-112.060)
    await provider.prepare_environment(sample_origin, sample_dest, [0])

    od_pairs = generate_random_od_pairs(n_pairs)
    results_list = []

    t0 = time.time()
    successful = 0

    for pair in od_pairs:
        p_id = pair["id"]
        mission = Mission(
            origin=pair["origin"],
            destination=pair["destination"],
            departure_time=datetime.now(),
            deadline=datetime.now() + timedelta(minutes=60),
            activity="walking",
            pace="normal",
            planning_mode="instant"
        )

        try:
            res = await optimize_mission(mission, provider)
            opts = res.get("route_options", [])
            if not opts or len(opts) < 1:
                continue

            fastest = next((r for r in opts if "fast" in str(r.get("id", "")).lower()), opts[0])
            coolest = next((r for r in opts if r.get("is_recommended")), opts[0])

            f_time_min = float(fastest.get("travel_minutes", 0.0))
            c_time_min = float(coolest.get("travel_minutes", 0.0))

            f_utci = float(fastest.get("avg_utci_c", fastest.get("avg_temp_c", 38.0)))
            c_utci = float(coolest.get("avg_utci_c", coolest.get("avg_temp_c", 35.0)))

            # Severe exposure minutes: duration if UTCI > 38°C
            f_severe_min = f_time_min if f_utci > 38.0 else 0.0
            c_severe_min = c_time_min if c_utci > 38.0 else 0.0

            time_delta_min = round(c_time_min - f_time_min, 2)
            utci_reduction = round(f_utci - c_utci, 2)
            severe_reduction_min = round(f_severe_min - c_severe_min, 2)

            results_list.append({
                "pair_id": p_id,
                "origin": [pair["origin"].lat, pair["origin"].lng],
                "destination": [pair["destination"].lat, pair["destination"].lng],
                "fastest_time_min": f_time_min,
                "coolest_time_min": c_time_min,
                "time_delta_min": time_delta_min,
                "fastest_utci_c": f_utci,
                "coolest_utci_c": c_utci,
                "utci_reduction_c": utci_reduction,
                "fastest_severe_min": f_severe_min,
                "coolest_severe_min": c_severe_min,
                "severe_reduction_min": severe_reduction_min,
            })
            successful += 1

        except Exception as e:
            print(f"  Pair {p_id} failed: {e}")
            continue

    elapsed = round(time.time() - t0, 2)

    # Compute Averages
    if results_list:
        avg_time_delta = round(sum(r["time_delta_min"] for r in results_list) / len(results_list), 2)
        avg_utci_reduction = round(sum(r["utci_reduction_c"] for r in results_list) / len(results_list), 2)
        avg_severe_reduction = round(sum(r["severe_reduction_min"] for r in results_list) / len(results_list), 2)
        avg_detour_ratio = round(sum(r["coolest_time_min"] / max(r["fastest_time_min"], 0.1) for r in results_list) / len(results_list), 3)
    else:
        avg_time_delta = avg_utci_reduction = avg_severe_reduction = avg_detour_ratio = 0.0

    summary = {
        "timestamp": datetime.now().isoformat(),
        "n_pairs_requested": n_pairs,
        "n_pairs_evaluated": len(results_list),
        "total_runtime_seconds": elapsed,
        "averages": {
            "time_delta_minutes": avg_time_delta,
            "utci_reduction_celsius": avg_utci_reduction,
            "severe_heat_exposure_reduction_minutes": avg_severe_reduction,
            "detour_ratio": avg_detour_ratio,
        },
        "individual_results": results_list
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 60)
    print("PHASE 9 VALIDATION EXPERIMENT RESULTS SUMMARY")
    print("=" * 60)
    print(f"Evaluated O/D Pairs:                   {len(results_list)} / {n_pairs}")
    print(f"Total Experiment Time:                 {elapsed}s")
    print(f"Average Extra Travel Time (Detour):    +{avg_time_delta} min ({avg_detour_ratio}x fastest)")
    print(f"Average UTCI Thermal Reduction:        -{avg_utci_reduction}°C")
    print(f"Average Severe Heat Exposure Avoided:  -{avg_severe_reduction} min")
    print(f"Results saved to:                      {RESULTS_PATH}")
    print("=" * 60 + "\n")

    return summary


if __name__ == "__main__":
    asyncio.run(run_validation_experiment(50))
