import base64
import logging
import os
from typing import Optional

import requests

from app.config import GOOGLE_API_KEY, GOOGLE_OAUTH_TOKEN, GOOGLE_PROJECT_ID

logger = logging.getLogger(__name__)

GCP_API_KEY = GOOGLE_API_KEY
GCP_PROJECT_ID = GOOGLE_PROJECT_ID
GCP_OAUTH_TOKEN = GOOGLE_OAUTH_TOKEN


def transcribe_audio_gcp(audio_bytes: bytes, mime_type: str = "audio/wav") -> Optional[str]:
    """Transcribe audio using Google's Speech-to-Text REST API."""
    if not audio_bytes:
        return None

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    encoding = "ENCODING_UNSPECIFIED"
    sample_rate = 16000

    mime_lower = (mime_type or "").lower()
    if "wav" in mime_lower:
        encoding = "LINEAR16"
        sample_rate = 16000
    elif "webm" in mime_lower:
        encoding = "WEBM_OPUS"
        sample_rate = 48000
    elif "ogg" in mime_lower:
        encoding = "OGG_OPUS"
        sample_rate = 48000
    elif "mp3" in mime_lower:
        encoding = "MP3"
        sample_rate = 16000
    elif "amr" in mime_lower:
        encoding = "AMR"
        sample_rate = 8000

    payload = {
        "config": {
            "encoding": encoding,
            "languageCode": "en-US",
            "enableAutomaticPunctuation": True,
            "model": "default",
        },
        "audio": {"content": audio_b64},
    }
    if encoding == "LINEAR16":
        payload["config"]["sampleRateHertz"] = sample_rate

    api_key = GCP_API_KEY.strip()
    url = "https://speech.googleapis.com/v1/speech:recognize"
    if api_key:
        url += f"?key={api_key}"

    headers = {"Content-Type": "application/json"}
    oauth_token = GCP_OAUTH_TOKEN.strip()
    if not api_key and not oauth_token:
        logger.warning("GCP Speech API is not configured")
        return None
    if oauth_token:
        headers["Authorization"] = f"Bearer {oauth_token}"

    quota_project = os.getenv("GOOGLE_CLOUD_QUOTA_PROJECT", GCP_PROJECT_ID).strip()
    if quota_project:
        headers["x-goog-user-project"] = quota_project

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        if response.status_code == 200:
            results = response.json().get("results", [])
            transcript = "".join(
                item.get("alternatives", [{}])[0].get("transcript", "")
                for item in results
            )
            return transcript.strip() or None

        logger.warning(
            "GCP Speech API returned a non-success status status_code=%s",
            response.status_code,
        )
    except Exception as exc:
        logger.warning(
            "GCP Speech API request failed exception_class=%s",
            type(exc).__name__,
        )

    return None
