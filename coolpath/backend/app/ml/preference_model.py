"""
Preference Model — Phase 6 Fix
================================
Changes:
  1. Expanded feature vector: adds heat_exposure, detour_ratio, shade_ratio, utci_max (12 → 16 features)
  2. Full route characteristics logged with every feedback event
  3. SQLite persistence — preferences survive server restarts
  4. Label convention standardised: y ∈ {0=dislike, 1=like} with assert guard
"""
import os
import math
import sqlite3
import json
import numpy as np
import logging
from typing import List, Dict, Any, Tuple, Optional
from pathlib import Path
from sklearn.linear_model import SGDClassifier

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "preferences.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Feature definition (documented for reproducibility)
# ---------------------------------------------------------------------------
FEATURE_NAMES = [
    "temperature",        # avg surface temp / 40 (normalised)
    "hour_sin",           # cyclical encoding: sin(2π*h/24)
    "hour_cos",           # cyclical encoding: cos(2π*h/24)
    "activity_walking",   # one-hot activity
    "activity_running",
    "activity_biking",
    "dist_short",         # one-hot distance bucket (< 1.5 km)
    "dist_medium",        # 1.5–4 km
    "dist_long",          # > 4 km
    "type_fastest",       # one-hot route archetype
    "type_coolest",
    "type_balanced",
    # Phase 6 additions ↓
    "heat_exposure_norm", # UTCI normalised (0-1) from route
    "detour_ratio",       # route_duration / fastest_duration (1.0 = fastest)
    "shade_ratio",        # average shade_ratio of route edges (0-1)
    "utci_max_norm",      # max UTCI on route / 70 (normalised)
]
N_FEATURES = len(FEATURE_NAMES)


def _init_db(db_path: Path = None):
    """Ensure the feedback SQLite table exists."""
    target_path = db_path or DB_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target_path))
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            route_type TEXT,
            satisfied INTEGER NOT NULL CHECK(satisfied IN (0, 1)),
            features_json TEXT,
            route_meta_json TEXT
        )
    """)
    conn.commit()
    conn.close()


_init_db()


class PreferenceModel:
    """
    Live-adapting online logistic regression powered by scikit-learn SGDClassifier.
    Learns user route preferences in real time from thumbs-up/thumbs-down feedback.
    
    Label convention:  y=1 → liked (thumbs up), y=0 → disliked (thumbs down)
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        _init_db(self.db_path)

        self.model = SGDClassifier(
            loss="log_loss",
            learning_rate="optimal",
            alpha=0.01,
            random_state=42,
        )
        # Initialise classifier with both classes so partial_fit always works
        dummy_x = np.zeros((2, N_FEATURES))
        dummy_y = np.array([0, 1])
        self.model.partial_fit(dummy_x, dummy_y, classes=np.array([0, 1]))

        self.beta = 0.45  # Product-policy prior: 55% physical travel time score, 45% learned ML preference score
        self.history: List[Dict[str, Any]] = []
        self.is_bootstrapped = False
        self._load_persisted_feedback()
        self.bootstrap_synthetic_data()

    def _load_persisted_feedback(self):
        """Replay persisted feedback from SQLite to restore trained weights."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            rows = conn.execute(
                "SELECT features_json, satisfied FROM feedback ORDER BY id LIMIT 500"
            ).fetchall()
            conn.close()
            if rows:
                X_list = [json.loads(r[0]) for r in rows]
                y_list = [int(r[1]) for r in rows]
                X_mat = np.array(X_list)
                y_vec = np.array(y_list)
                self.model.partial_fit(X_mat, y_vec)
                logger.info(f"[PreferenceModel] Loaded {len(rows)} persisted feedback samples from DB.")
        except Exception as e:
            logger.warning(f"[PreferenceModel] Could not load persisted feedback: {e}")

    def _persist_feedback(self, features: np.ndarray, satisfied: bool,
                          route_type: str, route_meta: dict, timestamp: float):
        """Save one feedback row to SQLite."""
        try:
            y_val = 1 if satisfied else 0
            # Invariant: label must be 0 or 1
            assert y_val in (0, 1), f"Invalid label: {y_val}"
            conn = sqlite3.connect(str(self.db_path))
            conn.execute(
                "INSERT INTO feedback (timestamp, route_type, satisfied, features_json, route_meta_json) "
                "VALUES (?, ?, ?, ?, ?)",
                (timestamp, route_type, y_val,
                 json.dumps(features.tolist()),
                 json.dumps(route_meta))
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"[PreferenceModel] DB write failed: {e}")

    def extract_features(
        self,
        route_type: str,
        context: Dict[str, Any],
        distance_m: float = 2000.0,
        route_meta: Optional[Dict[str, Any]] = None,
    ) -> np.ndarray:
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

        # Phase 6: new features from route metadata
        meta = route_meta or {}
        avg_utci = float(meta.get("avg_utci_c", temp + 5.0))
        from app.services.utci_model import normalize_utci_cost
        heat_exposure_norm = normalize_utci_cost(avg_utci)
        detour_ratio = float(meta.get("detour_ratio", 1.0))
        shade_ratio = float(meta.get("shade_ratio", 0.0))
        utci_max = float(meta.get("utci_max_c", avg_utci))
        utci_max_norm = min(1.0, utci_max / 70.0)

        vec = np.array([
            temp / 40.0,
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
            t_balanced,
            heat_exposure_norm,
            min(2.0, detour_ratio),  # cap at 2.0 for stability
            shade_ratio,
            utci_max_norm,
        ], dtype=np.float64)

        assert len(vec) == N_FEATURES, f"Feature vector length {len(vec)} != {N_FEATURES}"
        return vec.reshape(1, -1)

    def bootstrap_synthetic_data(self):
        """Seed model with ~25 synthetic interactions on cold start."""
        if self.is_bootstrapped:
            return

        np.random.seed(42)
        X_list = []
        y_list = []

        for _ in range(15):
            temp = np.random.uniform(28, 38)
            ctx = {"temp_c": temp, "hour": 14.0, "activity": "walking"}
            meta = {"avg_utci_c": temp + 8, "detour_ratio": 1.1, "shade_ratio": 0.2, "utci_max_c": temp + 12}
            vec_cool = self.extract_features("coolest", ctx, 2000.0, meta)
            X_list.append(vec_cool[0])
            y_list.append(1)  # y=1: liked

            meta_fast = {"avg_utci_c": temp + 12, "detour_ratio": 1.0, "shade_ratio": 0.0, "utci_max_c": temp + 16}
            vec_fast = self.extract_features("fastest", ctx, 2000.0, meta_fast)
            X_list.append(vec_fast[0])
            y_list.append(0)  # y=0: disliked

        for _ in range(5):
            ctx = {"temp_c": 24.0, "hour": 9.0, "activity": "biking"}
            meta = {"avg_utci_c": 28.0, "detour_ratio": 1.0, "shade_ratio": 0.0, "utci_max_c": 30.0}
            vec_fast = self.extract_features("fastest", ctx, 800.0, meta)
            X_list.append(vec_fast[0])
            y_list.append(1)

        X_mat = np.array(X_list)
        y_vec = np.array(y_list)
        self.model.partial_fit(X_mat, y_vec)
        self.is_bootstrapped = True
        logger.info("PreferenceModel successfully bootstrapped with synthetic interactions.")

    def predict_satisfaction(
        self,
        route_type: str,
        context: Dict[str, Any],
        distance_m: float = 2000.0,
        route_meta: Optional[Dict[str, Any]] = None,
    ) -> float:
        x_vec = self.extract_features(route_type, context, distance_m, route_meta)
        probs = self.model.predict_proba(x_vec)[0]
        return float(probs[1]) if len(probs) > 1 else 0.5

    def update_feedback(
        self,
        route_type: str,
        context: Dict[str, Any],
        satisfied: bool,
        distance_m: float = 2000.0,
        route_meta: Optional[Dict[str, Any]] = None,
    ) -> float:
        """
        Record thumbs-up (satisfied=True, y=1) or thumbs-down (satisfied=False, y=0).
        Persists to SQLite and updates model immediately via partial_fit.
        """
        x_vec = self.extract_features(route_type, context, distance_m, route_meta)
        y_val = 1 if satisfied else 0
        # Invariant assertion — must always be 0 or 1
        assert y_val in (0, 1), f"update_feedback: invalid label {y_val}"

        self.model.partial_fit(x_vec, np.array([y_val]))

        # Phase 6: persist full route metadata to SQLite
        timestamp = float(context.get("timestamp", 0))
        self._persist_feedback(x_vec[0], satisfied, route_type, route_meta or {}, timestamp)

        new_prob = self.predict_satisfaction(route_type, context, distance_m, route_meta)
        self.history.append({
            "timestamp": timestamp,
            "route_type": route_type,
            "satisfied": satisfied,
            "y_label": y_val,
            "new_prob": round(new_prob, 3),
            "shade_preference": round(self.get_shade_preference_percentage(), 1),
            "route_meta": route_meta or {},
        })
        if len(self.history) > 50:
            self.history = self.history[-50:]

        return new_prob

    def get_shade_preference_percentage(self) -> float:
        """Compute current learned preference for shade/coolest routes (0–100%)."""
        ctx_hot = {"temp_c": 32.0, "hour": 14.0, "activity": "walking"}
        meta_cool = {"avg_utci_c": 38.0, "detour_ratio": 1.1, "shade_ratio": 0.3, "utci_max_c": 42.0}
        meta_fast = {"avg_utci_c": 44.0, "detour_ratio": 1.0, "shade_ratio": 0.0, "utci_max_c": 48.0}
        p_cool = self.predict_satisfaction("coolest", ctx_hot, 2000.0, meta_cool)
        p_fast = self.predict_satisfaction("fastest", ctx_hot, 2000.0, meta_fast)
        total = p_cool + p_fast
        if total <= 0:
            return 50.0
        return float(np.clip((p_cool / total) * 100.0, 15.0, 95.0))

    def rank_route_options(
        self,
        route_options: List[Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], float]:
        if not route_options:
            return route_options, self.get_shade_preference_percentage()

        times = [r.get("travel_minutes", 10.0) for r in route_options]
        min_time = min(times)
        max_time = max(times)
        time_span = max(max_time - min_time, 0.1)

        for r in route_options:
            r_type = r.get("id", r.get("tag", "coolest"))
            dist_m = float(r.get("travel_minutes", 10.0)) * 60.0 * 1.4

            # Build route_meta for Phase 6 features
            route_meta = {
                "avg_utci_c": float(r.get("avg_utci_c", r.get("avg_temp_c", 36.0))) + 5.0,
                "detour_ratio": float(r.get("travel_minutes", 10.0)) / max(min_time, 0.1),
                "shade_ratio": float(r.get("shade_ratio", 0.0)),
                "utci_max_c": float(r.get("avg_utci_c", r.get("avg_temp_c", 36.0))) + 8.0,
            }

            p_sat = self.predict_satisfaction(r_type, context, dist_m, route_meta)
            r["predicted_satisfaction"] = round(p_sat, 2)

            norm_time_score = 1.0 - ((r.get("travel_minutes", 10.0) - min_time) / time_span)
            r["normalized_time_score"] = round(norm_time_score, 2)

            combined = (1.0 - self.beta) * norm_time_score + self.beta * p_sat
            r["combined_score"] = round(combined, 3)

        route_options.sort(key=lambda r: r["combined_score"], reverse=True)

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
