from fastapi import FastAPI
from app.config import DEMO_MODE

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import json

import os

app = FastAPI(title="CoolPath Thermal Dispatch Gate API")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Parse CORS origins from environment
cors_env = os.getenv("CORS_ALLOWED_ORIGINS", "")
if cors_env:
    origins = [origin.strip() for origin in cors_env.split(",") if origin.strip()]
else:
    # Safe defaults if not specified (local dev only)
    origins = [
        "http://localhost:3000",
        "http://localhost:5173"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "demo_mode": DEMO_MODE
    }

@app.get("/api/bundle/check")
def check_bundle_update():
    meta_file = STATIC_DIR / "bundle_meta.json"
    if meta_file.exists():
        try:
            with open(meta_file, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 0, "available": False}
