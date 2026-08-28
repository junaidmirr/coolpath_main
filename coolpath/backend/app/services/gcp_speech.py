import base64
import requests
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Fallbacks for credentials supplied by user
GCP_API_KEY = os.getenv("GOOGLE_API_KEY", "AIzaSyDfpnHbFpCLvX6_mOfFEJUOzCt5QMvTYOc")
GCP_PROJECT_ID = os.getenv("GOOGLE_PROJECT_ID", "avian-augury-205417")
GCP_OAUTH_TOKEN = os.getenv("GOOGLE_OAUTH_TOKEN", "ya29.a0AdMD6EgnhQkKQzWokd7eUYDq9u515Cgk94TsYGYtE3bpBwiRFDHmMruzF3G2nAwShaZAxD6ji_oJuwDI4YcUFu-TgmQW6PwtCiKh1T5bqs3XVH2FnKvVK8qBpxHSxae9Qa5jQ2UPbtEd5AS6NddcloQpZuQA-6ISh4U259kHS_MJSRHRMoiLQRqaRW4uK4H8GGmq5ruzf29w19uIjlFcn40ew2geD9G0yrYy9KN2-ElSh6OeQODVjaXAUm4IGcp2SEg2_EOT2olFtKAYJ0V2CFfrhLYY76auuwLBl3PCIDPq2j4h3zi6_nMCBxzn-ZLIQKW8OC4smsfeUxENcS2M8mUMYhY1N-d3rSEd_CgJyMTlfWcaCgYKAZcSARESFQHGX2Miof_oIjb_jKRqDJuTB1cJuA0374")

def transcribe_audio_gcp(audio_bytes: bytes, mime_type: str = "audio/wav") -> Optional[str]:
    """
    Transcribes audio using Google Cloud Speech-to-Text REST API.
    Uses the user's permanent API key or temporary OAuth token.
    """
    if not audio_bytes:
        return None

    # Base64 encode the audio bytes
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    # Map MIME types/extensions to GCP Speech config
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
    elif "m4a" in mime_lower or "mp4" in mime_lower or "aac" in mime_lower:
        encoding = "ENCODING_UNSPECIFIED"

    payload = {
        "config": {
            "encoding": encoding,
            "languageCode": "en-US",
            "enableAutomaticPunctuation": True,
            "model": "default"
        },
        "audio": {
            "content": audio_b64
        }
    }
    
    if encoding == "LINEAR16":
        payload["config"]["sampleRateHertz"] = sample_rate

    # Build request URL (prefer API key if available)
    api_key = os.getenv("GOOGLE_API_KEY", GCP_API_KEY).strip()
    url = f"https://speech.googleapis.com/v1/speech:recognize"
    if api_key:
        url += f"?key={api_key}"

    headers = {
        "Content-Type": "application/json",
    }
    
    oauth_token = os.getenv("GOOGLE_OAUTH_TOKEN", GCP_OAUTH_TOKEN).strip()
    if oauth_token:
        headers["Authorization"] = f"Bearer {oauth_token}"
    
    quota_project = os.getenv("GOOGLE_CLOUD_QUOTA_PROJECT", GCP_PROJECT_ID).strip()
    if quota_project:
        headers["x-goog-user-project"] = quota_project

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        if response.status_code == 200:
            res_data = response.json()
            results = res_data.get("results", [])
            if results:
                transcript = "".join(
                    r.get("alternatives", [{}])[0].get("transcript", "")
                    for r in results
                )
                if transcript.strip():
                    return transcript.strip()
            return None
        else:
            logger.warning(f"GCP Speech API returned status code {response.status_code}: {response.text}")
    except Exception as e:
        logger.warning(f"Error calling GCP Speech API: {e}")

    return None
