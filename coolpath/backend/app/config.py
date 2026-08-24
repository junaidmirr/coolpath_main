import os
from dotenv import load_dotenv

load_dotenv()

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
FORTYGUARD_API_KEY = os.getenv("FORTYGUARD_API_KEY", "")
MAPBOX_TOKEN = os.getenv(
    "MAPBOX_TOKEN",
    "pk.eyJ1IjoianVuYWlkbWlyMDUxIiwiYSI6ImNtc3l0MWFwNjAzMmsyenNrbW1mMjI0aHcifQ.j8_w_jQUiv26L8QYQVSBVA"
)
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
