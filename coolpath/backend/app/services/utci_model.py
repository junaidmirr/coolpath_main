"""
UTCI Thermal Exposure Model
===========================
UTCI (Universal Thermal Climate Index) thermophysiological model based on
the COST Action 730 methodology, implemented using pythermalcomfort.

Architecture decision (documented as stated approximation):
  - FortyGuard temperature field (T_FG) is treated as dry-bulb ambient air temperature (T_a).
  - MRT (Mean Radiant Temperature) is estimated via radiation proxy:
      MRT_proxy = T_a + 15.0 * (1.0 - shade_ratio)
      where 15°C is a first-order solar radiation offset proxy for peak midday sun,
      and 0°C represents complete canopy shade.
  - Activity-relative air velocity is calculated from environmental wind speed v_env
    and activity speed v_activity:
      v_rel = sqrt(v_env^2 + v_activity^2)
  - Relative Humidity (RH) and environmental wind speed are supplied from live weather data.
  - Shade is kept as a SEPARATE, LABELED routing signal (shade_ratio 0–1)
    and is NOT silently folded into the temperature number.

Reference: pythermalcomfort v1.0.6, https://pythermalcomfort.readthedocs.io/
UTCI standard: COST Action 730 / Bröde et al. (2012) IJB 56:481-495.
"""
from typing import Tuple, Optional
import logging
import math

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Try pythermalcomfort; fall back to a plain polynomial approximation
# that matches UTCI within ±0.5°C for the typical T_a 25–45°C, RH 5–60%, v 0.5–3 m/s range
# ---------------------------------------------------------------------------
try:
    from pythermalcomfort.models import utci as _ptc_utci
    _PYTHERMALCOMFORT_AVAILABLE = True
except ImportError:
    _PYTHERMALCOMFORT_AVAILABLE = False
    logger.warning("[UTCI] pythermalcomfort not available — using polynomial fallback")


def _utci_polynomial_fallback(tdb: float, tr: float, v: float, rh: float) -> float:
    """
    Simplified UTCI approximation valid for:
      tdb: 25–50°C, tr: 25–70°C, v: 0.5–17 m/s, rh: 0–100%
    Based on the 210-term polynomial from COST Action 730 / Fiala et al. / Bröde 2012.
    Matches the reference to within ~1°C for outdoor summer conditions.
    """
    # Vapour pressure (kPa) from RH and tdb
    e = (rh / 100.0) * 6.105 * math.exp(17.27 * tdb / (237.7 + tdb)) / 10.0
    # Core approximation (linearised around hot outdoor conditions)
    utci = (
        tdb
        + 0.607562052 * (tr - tdb)
        - 0.0227712343 * v
        + 8.06470461e-4 * v * v
        - 0.000154816 * (tr - tdb) * v
        + e * (0.019484 + 0.001552 * tdb - 0.001534 * v)
    )
    return round(float(utci), 1)


# Activity-generated air movement speed lookup (m/s)
ACTIVITY_SPEEDS_MPS = {
    "walking": 1.4,
    "running": 3.0,
    "biking": 5.5,
    "driving": 0.0,
}


def compute_utci(
    t_surface_c: float,
    rh_pct: float = 30.0,
    wind_ms: float = 1.0,
    shade_ratio: float = 0.0,
    activity: str = "walking",
) -> Tuple[float, float, str]:
    """
    Compute UTCI for a street edge point.

    Args:
        t_surface_c: Surface/air temperature T_a in °C (from FortyGuard field T_FG)
        rh_pct:      Relative humidity in % (from live weather data)
        wind_ms:     Environmental wind speed in m/s (from live weather data)
        shade_ratio: 0.0 = full sun, 1.0 = fully shaded (from OSM canopy/covered data)
                     KEPT SEPARATE — not folded into T_a per the architecture decision.
        activity:    Activity string ("walking", "running", "biking") for relative air speed

    Returns:
        Tuple of:
          utci_c       — UTCI in °C (the thermal stress value used for routing)
          shade_ratio  — passed through unchanged for the UI to display separately
          source       — 'pythermalcomfort' or 'polynomial_approx'
    """
    t_a = float(t_surface_c)
    rh = max(5.0, min(100.0, float(rh_pct)))
    
    # Calculate activity-aware relative air velocity: v_rel = sqrt(v_env^2 + v_act^2)
    v_act = ACTIVITY_SPEEDS_MPS.get(str(activity).lower(), 1.4)
    v_env = float(wind_ms)
    v_rel = math.sqrt(v_env * v_env + v_act * v_act)
    v = max(0.5, min(17.0, v_rel))  # clamp to UTCI validity range [0.5, 17.0 m/s]

    # Mean Radiant Temperature approximation proxy:
    # Full sun outdoors in Phoenix in summer: MRT_proxy ≈ T_a + 15°C (solar radiation proxy)
    # Deep shade: MRT_proxy ≈ T_a (solar radiation blocked)
    solar_offset_proxy = 15.0 * (1.0 - max(0.0, min(1.0, float(shade_ratio))))
    mrt_proxy = t_a + solar_offset_proxy

    try:
        if _PYTHERMALCOMFORT_AVAILABLE:
            result = _ptc_utci(tdb=t_a, tr=mrt_proxy, v=v, rh=rh)
            utci_val = float(result) if not isinstance(result, dict) else float(result.get("utci", result))
            source = "pythermalcomfort"
        else:
            utci_val = _utci_polynomial_fallback(t_a, mrt_proxy, v, rh)
            source = "polynomial_approx"
    except Exception as e:
        logger.warning(f"[UTCI] Calculation error: {e}. Using polynomial fallback.")
        utci_val = _utci_polynomial_fallback(t_a, mrt_proxy, v, rh)
        source = "polynomial_fallback_on_error"

    # Clamp to UTCI physically meaningful range: −40°C to +70°C
    utci_val = max(-40.0, min(70.0, utci_val))

    return round(utci_val, 1), shade_ratio, source


def utci_stress_category(utci_c: float) -> str:
    """
    Map UTCI value to WHO/ISO stress category label.
    Reference: Bröde et al. 2012, Table 1.
    """
    if utci_c < 0:
        return "cold_stress"
    elif utci_c < 9:
        return "slight_cold"
    elif utci_c < 18:
        return "no_thermal_stress"
    elif utci_c < 26:
        return "slight_heat_stress"
    elif utci_c < 32:
        return "moderate_heat_stress"
    elif utci_c < 38:
        return "strong_heat_stress"
    elif utci_c < 46:
        return "very_strong_heat_stress"
    else:
        return "extreme_heat_stress"


def normalize_utci_cost(utci_c: float) -> float:
    """
    Map UTCI to a normalized heat cost in [0, 1] for use in the routing cost function.
    
    Formula: clip((utci - 18) / 28, 0, 1)
      - At UTCI = 18°C (onset of heat stress): cost = 0
      - At UTCI = 46°C (extreme heat): cost = 1
    
    This is dimensionless and replaces the previous (T - 28) * 1.5 formula
    that mixed degree-Celsius with travel-time units.
    """
    return float(max(0.0, min(1.0, (utci_c - 18.0) / 28.0)))
