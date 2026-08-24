import os
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def get_polly_client():
    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    aws_region = os.getenv("AWS_REGION", "us-east-1")

    if not aws_key or not aws_secret:
        return None

    try:
        import boto3
        return boto3.client(
            "polly",
            aws_access_key_id=aws_key.strip(),
            aws_secret_access_key=aws_secret.strip(),
            region_name=aws_region.strip()
        )
    except Exception as e:
        logger.warning(f"AWS Polly client initialization error: {e}")
        return None


def synthesize_speech_polly(text: str, voice_id: str = "Salli", engine: str = "standard") -> Optional[str]:
    """
    Synthesizes text using Amazon Polly TTS.
    Default VoiceId is 'Salli' (Standard female US English voice).
    Returns a base64 encoded MP3 string, or None if credentials/synthesis fail.
    """
    client = get_polly_client()
    if not client or not text or not text.strip():
        return None

    try:
        response = client.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId=voice_id,
            Engine=engine
        )
        if "AudioStream" in response:
            audio_data = response["AudioStream"].read()
            return base64.b64encode(audio_data).decode("utf-8")
    except Exception as e:
        logger.error(f"Amazon Polly TTS synthesis failed: {e}")
        return None

    return None
