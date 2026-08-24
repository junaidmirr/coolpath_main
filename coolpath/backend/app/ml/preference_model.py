import os
import math
import numpy as np
import logging
from typing import List, Dict, Any, Tuple
from sklearn.linear_model import SGDClassifier

logger = logging.getLogger(__name__)

FEATURE_NAMES = [
    "temperature",
    "hour_sin",
    "hour_cos",
    "activity_walking",
    "activity_running",
    "activity_biking",
    "dist_short",
    "dist_medium",
    "dist_long",
    "type_fastest",
    "type_coolest",
    "type_balanced"
]

class PreferenceModel:
    """
    Live-adapting online logistic regression model powered by scikit-learn SGDClassifier.
    Learns user route preferences in real time from one-click feedback (👍 / 👎).
    """

    def __init__(self):
        self.model = SGDClassifier(
            loss="log_loss",
            learning_rate="optimal",
            alpha=0.01,
            random_state=42
        )
        # Initialize classes with zero features
        dummy_x = np.zeros((2, len(FEATURE_NAMES)))
        dummy_y = np.array([0, 1])
        self.model.partial_fit(dummy_x, dummy_y, classes=np.array([0, 1]))

        self.beta = 0.45  # Weight of preference score vs physics time score
        self.history: List[Dict[str, Any]] = []
        self.is_bootstrapped = False
        self.bootstrap_synthetic_data()

    def extract_features(self, route_type: str, context: Dict[str, Any], distance_m: float = 2000.0) -> np.ndarray:
        temp = float(context.get("temp_c", 32.0))
        hour = float(context.get("hour", 14.0))

        hour_sin = math.sin(2.0 * math.pi * hour / 24.0)
        hour_cos = math.cos(2.0 * math.pi * hour / 24.0)

        activity = str(context.get("activity", "walking")).lower()
        act_walk = 1.0 if activity == "walking" else 0.0
        act_run = 1.0 if activity == "running" else 0.0
        act_bike = 1.0 if activity == "biking" else 0.0

        dist_km = distance_m / 1000.0
        dist_short = 1.0 if dist_km < 1.5 else 0.0
        dist_medium = 1.0 if 1.5 <= dist_km <= 4.0 else 0.0
        dist_long = 1.0 if dist_km > 4.0 else 0.0

        r_type = str(route_type or "coolest").lower()
        t_fastest = 1.0 if "fast" in r_type else 0.0
        t_coolest = 1.0 if "cool" in r_type or "shade" in r_type or "recommend" in r_type else 0.0
        t_balanced = 1.0 if "balance" in r_type else 0.0

        vec = np.array([
            temp / 40.0,  # Normalized temperature around ~0.8
            hour_sin,
            hour_cos,
            act_walk,
            act_run,
            act_bike,
            dist_short,
            dist_medium,
            dist_long,
            t_fastest,
            t_coolest,
            t_balanced
        ], dtype=np.float64)

        return vec.reshape(1, -1)

    def bootstrap_synthetic_data(self):
        """Seeds model with ~25 synthetic interactions (shade-cautious archetype) on cold start."""
        if self.is_bootstrapped:
            return

        np.random.seed(42)
        X_list = []
        y_list = []

        for _ in range(15):
            # Shade-cautious interactions: likes coolest route when temp is high
            temp = np.random.uniform(28, 38)
            ctx = {"temp_c": temp, "hour": 14.0, "activity": "walking"}
            vec_cool = self.extract_features("coolest", ctx, distance_m=2000.0)
            X_list.append(vec_cool[0])
            y_list.append(1)

            vec_fast = self.extract_features("fastest", ctx, distance_m=2000.0)
            X_list.append(vec_fast[0])
            y_list.append(0)

        for _ in range(5):
            # Speed interactions for short distance
            ctx = {"temp_c": 24.0, "hour": 9.0, "activity": "biking"}
            vec_fast = self.extract_features("fastest", ctx, distance_m=800.0)
            X_list.append(vec_fast[0])
            y_list.append(1)

        X_mat = np.array(X_list)
        y_vec = np.array(y_list)
        self.model.partial_fit(X_mat, y_vec)
        self.is_bootstrapped = True
        logger.info("PreferenceModel successfully bootstrapped with synthetic interactions.")

    def predict_satisfaction(self, route_type: str, context: Dict[str, Any], distance_m: float = 2000.0) -> float:
        x_vec = self.extract_features(route_type, context, distance_m)
        probs = self.model.predict_proba(x_vec)[0]
        return float(probs[1]) if len(probs) > 1 else 0.5

    def update_feedback(self, route_type: str, context: Dict[str, Any], satisfied: bool, distance_m: float = 2000.0) -> float:
        x_vec = self.extract_features(route_type, context, distance_m)
        y_val = 1 if satisfied else 0
        self.model.partial_fit(x_vec, np.array([y_val]))

        new_prob = self.predict_satisfaction(route_type, context, distance_m)
        self.history.append({
            "timestamp": context.get("timestamp", 0),
            "route_type": route_type,
            "satisfied": satisfied,
            "new_prob": round(new_prob, 3),
            "shade_preference": round(self.get_shade_preference_percentage(), 1)
        })
        if len(self.history) > 20:
            self.history = self.history[-20:]

        return new_prob

    def get_shade_preference_percentage(self) -> float:
        """Computes current learned preference percentage for shade/coolest routes (0-100%)."""
        ctx_hot = {"temp_c": 32.0, "hour": 14.0, "activity": "walking"}
        p_cool = self.predict_satisfaction("coolest", ctx_hot, 2000.0)
        p_fast = self.predict_satisfaction("fastest", ctx_hot, 2000.0)

        total = p_cool + p_fast
        if total <= 0:
            return 50.0
        ratio = (p_cool / total) * 100.0
        return float(np.clip(ratio, 15.0, 95.0))

    def rank_route_options(self, route_options: List[Dict[str, Any]], context: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], float]:
        if not route_options:
            return route_options, self.get_shade_preference_percentage()

        # Find min/max travel time for normalization
        times = [r.get("travel_minutes", 10.0) for r in route_options]
        min_time = min(times)
        max_time = max(times)
        time_span = max(max_time - min_time, 0.1)

        for r in route_options:
            r_type = r.get("id", r.get("tag", "coolest"))
            dist_m = float(r.get("travel_minutes", 10.0)) * 60.0 * 1.4

            p_sat = self.predict_satisfaction(r_type, context, dist_m)
            r["predicted_satisfaction"] = round(p_sat, 2)

            # Physics time score: 1.0 for fastest time, decreasing for longer routes
            norm_time_score = 1.0 - ((r.get("travel_minutes", 10.0) - min_time) / time_span)
            r["normalized_time_score"] = round(norm_time_score, 2)

            # Combined score equation
            combined = (1.0 - self.beta) * norm_time_score + self.beta * p_sat
            r["combined_score"] = round(combined, 3)

        # Sort routes by combined_score descending
        route_options.sort(key=lambda r: r["combined_score"], reverse=True)

        # Assign is_recommended to top ranked option
        for idx, r in enumerate(route_options):
            r["is_recommended"] = (idx == 0)
            if idx == 0:
                r["tag"] = "❄️ Recommended for You"
            elif "fast" in str(r.get("id", "")).lower():
                r["tag"] = "⚡ Direct Path"
            else:
                r["tag"] = "🌱 Scenic Shaded"

        return route_options, self.get_shade_preference_percentage()


# Global Singleton Instance
preference_model = PreferenceModel()
