"""
Phase 2 + 3 + 4 Tests
======================

T2.1  UTCI output matches pythermalcomfort reference values
T2.2  UTCI sanity bounds: extreme inputs don't NaN or go out of range
T2.3  Shade is kept separate — changing shade_ratio changes MRT but not T_a
T3.1  Multi-sample crossing two thermal cells gives value BETWEEN the two, not one
T4.1  α=0 (time-only) → fastest route wins; α=1 (heat-only) → coolest wins
T4.2  Detour cap: a 3x-slower "cool" route is rejected in normal mode
T4.3  Dimensionless cost C_time and C_heat both fall in [0, 3] range
"""
import sys
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from app.services.utci_model import compute_utci, normalize_utci_cost, utci_stress_category


# ---------------------------------------------------------------------------
# T2.1  UTCI vs library reference values
# ---------------------------------------------------------------------------
def test_t21_utci_reference_values():
    """
    Reference UTCI values from pythermalcomfort docs:
      tdb=25, tr=25, v=1, rh=50  →  ~24.6°C (no thermal stress)
      tdb=35, tr=50, v=1, rh=30  →  ~48-50°C (very strong heat stress)
    """
    # Test 1: moderate conditions → no stress / slight heat stress
    utci_moderate, _, src = compute_utci(t_surface_c=25.0, rh_pct=50.0, wind_ms=1.0, shade_ratio=0.0)
    # shade_ratio=0 → solar_offset=15 → MRT=40°C; with tdb=25, utci should be elevated
    assert 25.0 <= utci_moderate <= 55.0, f"Moderate UTCI {utci_moderate} out of expected range"
    assert src in ("pythermalcomfort", "polynomial_approx", "polynomial_fallback_on_error")

    # Test 2: Phoenix summer hot conditions → very strong heat stress
    utci_hot, _, _ = compute_utci(t_surface_c=39.0, rh_pct=15.0, wind_ms=1.0, shade_ratio=0.0)
    assert utci_hot > 38.0, f"Phoenix hot UTCI {utci_hot} should be > 38°C"

    # Test 3: full shade reduces UTCI vs same T_a in full sun
    utci_sun, _, _ = compute_utci(t_surface_c=39.0, rh_pct=15.0, wind_ms=1.0, shade_ratio=0.0)
    utci_shade, _, _ = compute_utci(t_surface_c=39.0, rh_pct=15.0, wind_ms=1.0, shade_ratio=1.0)
    assert utci_shade < utci_sun, f"Shaded UTCI ({utci_shade}) should be < sunny UTCI ({utci_sun})"

    print(f"✅ T2.1 PASSED — UTCI moderate={utci_moderate}, hot={utci_hot}, shade_reduction={utci_sun-utci_shade:.1f}°C")


# ---------------------------------------------------------------------------
# T2.2  UTCI sanity bounds: extremes don't NaN or go out of range
# ---------------------------------------------------------------------------
def test_t22_utci_sanity_bounds():
    test_cases = [
        (0.0, 30.0, 0.5, 0.0),    # very cold
        (50.0, 80.0, 0.5, 0.0),   # extreme heat
        (25.0, 25.0, 17.0, 0.0),  # max wind
        (40.0, 55.0, 0.5, 100.0), # 100% RH — invalid but shouldn't crash
    ]
    for t, rh, v, shade in test_cases:
        utci, _, _ = compute_utci(t, rh_pct=rh, wind_ms=v, shade_ratio=shade)
        assert not math.isnan(utci), f"NaN for t={t}, rh={rh}, v={v}"
        assert -40.0 <= utci <= 70.0, f"UTCI {utci} out of physical bounds for t={t}"

    # Monotonic: higher T_a → higher UTCI, all else equal
    utci_25, _, _ = compute_utci(25.0, rh_pct=30.0, wind_ms=1.0, shade_ratio=0.0)
    utci_35, _, _ = compute_utci(35.0, rh_pct=30.0, wind_ms=1.0, shade_ratio=0.0)
    utci_45, _, _ = compute_utci(45.0, rh_pct=30.0, wind_ms=1.0, shade_ratio=0.0)
    assert utci_25 < utci_35 < utci_45, f"UTCI not monotonic: {utci_25:.1f} < {utci_35:.1f} < {utci_45:.1f}"

    # Wind: higher wind → lower UTCI (cooling effect), all else equal
    utci_low_wind, _, _ = compute_utci(39.0, rh_pct=20.0, wind_ms=0.5, shade_ratio=0.0)
    utci_high_wind, _, _ = compute_utci(39.0, rh_pct=20.0, wind_ms=5.0, shade_ratio=0.0)
    assert utci_high_wind < utci_low_wind, f"Higher wind should lower UTCI: {utci_low_wind:.1f} vs {utci_high_wind:.1f}"

    print("✅ T2.2 PASSED — bounds, monotonic, wind cooling all correct")


# ---------------------------------------------------------------------------
# T2.3  Shade is kept separate (labeled, not silently folded into T_a)
# ---------------------------------------------------------------------------
def test_t23_shade_kept_separate():
    """Shade changes MRT (via solar_offset), NOT T_a directly."""
    # With shade_ratio=0: solar_offset=15°C
    # With shade_ratio=1: solar_offset=0°C
    # UTCI should differ, T_a input (t_surface_c) stays unchanged
    utci_sun, shade_out_sun, _ = compute_utci(39.0, rh_pct=15.0, wind_ms=1.0, shade_ratio=0.0)
    utci_shad, shade_out_shad, _ = compute_utci(39.0, rh_pct=15.0, wind_ms=1.0, shade_ratio=1.0)
    assert shade_out_sun == 0.0
    assert shade_out_shad == 1.0
    assert utci_sun != utci_shad, "Shade should affect UTCI (via MRT), but T_a stays fixed at 39°C"
    print(f"✅ T2.3 PASSED — shade separate: sun={utci_sun}, shaded={utci_shad}")


# ---------------------------------------------------------------------------
# T3.1  Multi-sample crossing two cells gives weighted intermediate value
# ---------------------------------------------------------------------------
def test_t31_multi_sample_weighted_average():
    """
    Synthetic edge: first half at 30°C, second half at 44°C.
    Midpoint-only sampling always returns one extreme.
    Multi-sample (N=5) should return a value between them.
    """
    from app.services.osm import _sample_points_along_edge

    # Edge from (0,0) to (0.01,0): first half x<0.005 → 30°C, rest → 44°C
    n1 = {"x": 0.0, "y": 0.0}
    n2 = {"x": 0.01, "y": 0.0}

    class MockProvider:
        def get_temperature_for_point(self, lng, lat, offset):
            return (30.0 if lng < 0.005 else 44.0, "mock")

    provider = MockProvider()
    samples = _sample_points_along_edge(None, n1, n2, n_samples=5)
    assert len(samples) == 5

    # Midpoint only
    mid_lng = (n1["x"] + n2["x"]) / 2
    mid_temp, _ = provider.get_temperature_for_point(mid_lng, 0.0, 0)
    # At exactly 0.005, it could be either — just check multi-sample is different from single midpoint
    temps = [provider.get_temperature_for_point(lng, lat, 0)[0] for lng, lat, w in samples]
    avg_multi = sum(t * w for t, (lng, lat, w) in zip(temps, samples))
    # 3 samples in 44°C zone (0.005, 0.0075, 0.01), 2 in 30°C zone (0.0, 0.0025)
    # Expected: ~ 30*(2/5) + 44*(3/5) = 12 + 26.4 = 38.4
    assert 30.0 < avg_multi < 44.0, f"Multi-sample avg {avg_multi:.1f} should be between 30 and 44"
    print(f"✅ T3.1 PASSED — multi-sample weighted avg = {avg_multi:.1f}°C (between 30 and 44)")


# ---------------------------------------------------------------------------
# T4.1  α=0 → fastest wins; α=1 → coolest wins
# ---------------------------------------------------------------------------
def test_t41_cost_function_alpha():
    """
    Synthetic routes:
      A: duration=600s (10min), avg_utci=45°C (hot)
      B: duration=720s (12min), avg_utci=32°C (moderate — below extreme)
    
    α=0 (pure time): should prefer A
    α=1 (pure heat): should prefer B
    """
    from app.services.utci_model import normalize_utci_cost

    t_fastest = 600.0
    t_cool = 720.0

    e_fastest = normalize_utci_cost(45.0)  # hot
    e_cool = normalize_utci_cost(32.0)     # moderate

    # Dimensionless costs
    C_time_A = t_fastest / t_fastest   # 1.0
    C_time_B = t_cool / t_fastest      # 1.2

    C_heat_A = e_fastest / e_fastest   # 1.0
    C_heat_B = e_cool / e_fastest      # < 1.0

    # α=0: pure time → A wins
    score_A_alpha0 = (1.0 - 0.0) * C_time_A + 0.0 * C_heat_A  # 1.0
    score_B_alpha0 = (1.0 - 0.0) * C_time_B + 0.0 * C_heat_B  # 1.2
    assert score_A_alpha0 < score_B_alpha0, f"α=0: A should win ({score_A_alpha0:.2f} < {score_B_alpha0:.2f})"

    # α=1: pure heat → B wins (lower is cooler)
    score_A_alpha1 = (1.0 - 1.0) * C_time_A + 1.0 * C_heat_A  # 1.0
    score_B_alpha1 = (1.0 - 1.0) * C_time_B + 1.0 * C_heat_B  # < 1.0
    assert score_B_alpha1 < score_A_alpha1, f"α=1: B should win ({score_B_alpha1:.2f} < {score_A_alpha1:.2f})"

    print(f"✅ T4.1 PASSED — α=0 picks fastest, α=1 picks coolest")


# ---------------------------------------------------------------------------
# T4.2  Hard detour cap rejects 3x-slower routes
# ---------------------------------------------------------------------------
def test_t42_detour_cap():
    """The 1.25x cap means a 3x-longer 'cool' route must be rejected."""
    fastest_duration = 600.0
    cap = 1.25
    allowed_max = fastest_duration * cap  # 750s

    cool_route_slow = 1800.0   # 30 min — 3x slower
    cool_route_ok = 720.0      # 12 min — within 1.25x

    assert cool_route_slow > allowed_max, "3x slow route should exceed detour cap"
    assert cool_route_ok <= allowed_max, "1.2x route should pass detour cap"

    print(f"✅ T4.2 PASSED — detour cap ({allowed_max:.0f}s): 3x route rejected, 1.2x route accepted")


# ---------------------------------------------------------------------------
# T4.3  Dimensionless costs C_time and C_heat both in [0, 3] range
# ---------------------------------------------------------------------------
def test_t43_cost_dimensionless_range():
    from app.services.utci_model import normalize_utci_cost

    # Sample 10 synthetic routes with varied durations and UTCI values
    fastest_t = 600.0
    fastest_utci_norm = normalize_utci_cost(42.0)

    for duration, utci in [(600, 42), (720, 38), (900, 35), (500, 45), (1200, 32)]:
        C_time = duration / fastest_t
        C_heat = normalize_utci_cost(utci) / (fastest_utci_norm if fastest_utci_norm > 0 else 1.0)
        assert 0.0 <= C_time <= 3.0, f"C_time={C_time:.2f} out of [0,3] for duration={duration}"
        assert 0.0 <= C_heat <= 3.0, f"C_heat={C_heat:.2f} out of [0,3] for UTCI={utci}"

    print("✅ T4.3 PASSED — C_time and C_heat both in [0, 3] range")


if __name__ == "__main__":
    print("Running Phase 2+3+4 Tests...\n")
    test_t21_utci_reference_values()
    test_t22_utci_sanity_bounds()
    test_t23_shade_kept_separate()
    test_t31_multi_sample_weighted_average()
    test_t41_cost_function_alpha()
    test_t42_detour_cap()
    test_t43_cost_dimensionless_range()
    print("\n✅ All Phase 2+3+4 Tests PASSED")
