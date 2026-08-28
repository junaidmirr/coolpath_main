"""
CoolPath Safety & Medical Policy Engine
========================================
Provides deterministic heat safety rules, pre-optimizer candidate safety filtering, and approved safety guidance.
Prevents LLM from inventing or hallucinating medical advice.

EXPLICIT SAFETY STATUSES:
- ALLOWED: Normal route optimization (safe to travel).
- FLAGGED: Advisory risk / High thermal strain (candidate retained, advisory warning attached).
- VETOED: Hard safety constraint violation (candidate removed from consideration).

NOTE ON THRESHOLDS:
All temperature and UTCI triggers (e.g., T_ambient >= 35.0°C for paw warning, UTCI >= 32.0°C for hyperthermia alert)
are conservative CoolPath Application Safety-Policy Thresholds designed for proactive user protection, rather than
universal clinical medical cutoffs. Standardized thermal stress indices (COST Action 730 UTCI) remain authoritative.
"""

from typing import List, Dict, Any, Tuple

class SafetyPolicyEngine:
    @staticmethod
    def evaluate_candidate_safety(
        candidate_route: Dict[str, Any],
        activity: str = "walking",
        special_profile_tags: List[str] = None
    ) -> Dict[str, Any]:
        """
        Evaluates a single candidate route against explicit safety policies.
        Inputs: activity, UTCI, ambient_temperature, shade_ratio, route_duration, profile_tags, pet_flag.
        
        Returns:
            Dict containing: { "status": "allowed" | "flagged" | "vetoed", "reason": str, "policy_id": str, "severity": "low" | "medium" | "high" }
        """
        tags = set(special_profile_tags or [])
        max_utci = candidate_route.get("max_utci_c", candidate_route.get("avg_utci_c", 35.0))
        avg_temp = candidate_route.get("avg_temp_c", 32.0)
        shade_ratio = candidate_route.get("shade_ratio", 0.5)

        # 1. HARD VETO: Extreme Heat Danger (UTCI > 46°C on unshaded asphalt)
        if max_utci > 46.0 and shade_ratio < 0.2:
            return {
                "status": "vetoed",
                "reason": "Extreme Thermal Danger: UTCI exceeds 46°C on unshaded asphalt",
                "policy_id": "POL_VETO_EXTREME_UTCI",
                "severity": "high"
            }

        # 2. HARD VETO: Pet Paw Protection (Unshaded asphalt >= 35°C ambient)
        if ("dog_walking" in tags or "pavement_heat_sensitivity" in tags) and avg_temp >= 35.0 and shade_ratio < 0.15:
            return {
                "status": "vetoed",
                "reason": "Unsafe Paw Pavement Temp: Midday unshaded asphalt exceeds 50°C surface heat",
                "policy_id": "POL_VETO_PAW_PAVEMENT_HEAT",
                "severity": "high"
            }

        # 3. ADVISORY FLAGGED: High Thermal Strain (UTCI >= 38°C or low shade running)
        if max_utci >= 38.0:
            return {
                "status": "flagged",
                "reason": "High Thermal Strain: Route experiences peak UTCI above 38°C. Hydration required.",
                "policy_id": "POL_FLAG_HIGH_UTCI_STRAIN",
                "severity": "medium"
            }

        if activity == "running" and max_utci >= 32.0 and shade_ratio < 0.3:
            return {
                "status": "flagged",
                "reason": "Running Heat Advisory: Unshaded running corridor with UTCI >= 32°C.",
                "policy_id": "POL_FLAG_RUNNING_HEAT_STRAIN",
                "severity": "medium"
            }

        return {
            "status": "allowed",
            "reason": "Route complies with all CoolPath safety policy thresholds",
            "policy_id": "POL_ALLOW_SAFE",
            "severity": "low"
        }

    @staticmethod
    def filter_and_flag_unsafe_candidates(
        candidate_routes: List[Dict[str, Any]],
        activity: str = "walking",
        special_profile_tags: List[str] = None
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Pre-Optimizer Safety Filter:
        Evaluates candidate routes against safety policy thresholds BEFORE multi-objective optimization.
        
        Returns:
            Tuple[safe_candidates: List[dict], flagged_candidates: List[dict]]
        """
        safe_candidates = []
        flagged_candidates = []

        for r in candidate_routes:
            eval_res = SafetyPolicyEngine.evaluate_candidate_safety(r, activity, special_profile_tags)
            route_entry = dict(r)
            route_entry["safety_status"] = eval_res["status"]
            route_entry["safety_reason"] = eval_res["reason"]
            route_entry["safety_policy_id"] = eval_res["policy_id"]
            route_entry["safety_severity"] = eval_res["severity"]
            route_entry["safety_flagged"] = (eval_res["status"] in {"flagged", "vetoed"})

            if eval_res["status"] == "vetoed":
                flagged_candidates.append(route_entry)
            else:
                safe_candidates.append(route_entry)

        # Fallback: If all routes are vetoed, preserve candidates with explicit safety warning flags
        if not safe_candidates:
            return candidate_routes, flagged_candidates

        return safe_candidates, flagged_candidates

    @staticmethod
    def get_approved_safety_guidance(
        activity: str,
        special_profile_tags: List[str],
        avg_temp_c: float,
        avg_utci_c: float
    ) -> Dict[str, str]:
        """
        Returns approved safety rules and guidance based on CoolPath application safety-policy thresholds.
        """
        tags = set(special_profile_tags or [])
        
        # 1. CoolPath Safety-Policy Threshold: Pavement & Paw Heat Risk
        if "dog_walking" in tags or "pavement_heat_sensitivity" in tags or avg_temp_c >= 35.0:
            paw_alert = "⚠️ Pavement Heat Warning: Unshaded asphalt reaches 50°C+ midday, risking paw pad burns. Shaded concrete corridor recommended."
        else:
            paw_alert = ""

        # 2. CoolPath Safety-Policy Threshold: Metabolic Hyperthermia Risk
        if activity == "running" and avg_utci_c >= 32.0:
            hyperthermia_alert = "🏃 Running Intensity Alert: Metabolic heat buildup accelerates hyperthermia above 32°C UTCI. Maintain steady pace and hydrate every 15 mins."
        elif activity == "biking" and avg_temp_c >= 36.0:
            hyperthermia_alert = "🚴 Biking Heat Strain: High ambient air velocity provides convective cooling, but UV exposure remains elevated."
        else:
            hyperthermia_alert = ""

        # 3. CoolPath Safety-Policy Threshold: Respiratory & Vulnerable Profile Risk
        if "respiratory_sensitivity" in tags or "asthma" in tags:
            health_alert = "🫁 Respiratory Heat Alert: High thermal stress and urban ozone can trigger airway constriction. Seek shaded green spaces."
        elif "child_care" in tags or "elderly" in tags:
            health_alert = "👶 Vulnerable Individual Care: Reduced thermoregulatory capacity. Avoid direct sun exposure between 11 AM and 4 PM."
        elif paw_alert:
            health_alert = paw_alert
        elif hyperthermia_alert:
            health_alert = hyperthermia_alert
        elif avg_utci_c >= 38.0:
            health_alert = "⚠️ Severe Heat Stress: UTCI exceeds 38°C. Take frequent shaded breaks and drink water regularly."
        else:
            health_alert = "💧 Heat Safety: Hydrate well and utilize shaded corridors during outdoor travel."

        return {
            "health_alert": health_alert,
            "paw_alert": paw_alert,
            "hyperthermia_alert": hyperthermia_alert
        }
