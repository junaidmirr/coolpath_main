import os
import time
import json
import uuid
import boto3
import logging
import requests
from typing import Optional

logger = logging.getLogger(__name__)

def transcribe_audio_aws(audio_bytes: bytes, mime_type: str = "audio/wav") -> Optional[str]:
    """
    Transcribes audio using AWS Transcribe.
    1. Uploads audio bytes to AWS S3 temporary storage bucket.
    2. Triggers AWS Transcribe job.
    3. Retrieves verbatim text result from AWS.
    """
    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    aws_region = os.getenv("AWS_REGION", "us-east-1")

    if not aws_key or not aws_secret or not audio_bytes:
        return None

    bucket_name = os.getenv("AWS_S3_BUCKET", "coolpath-transcribe-temp")

    try:
        s3 = boto3.client(
            "s3",
            aws_access_key_id=aws_key.strip(),
            aws_secret_access_key=aws_secret.strip(),
            region_name=aws_region.strip()
        )
        transcribe = boto3.client(
            "transcribe",
            aws_access_key_id=aws_key.strip(),
            aws_secret_access_key=aws_secret.strip(),
            region_name=aws_region.strip()
        )

        # Ensure S3 bucket exists or create it
        try:
            if aws_region == "us-east-1":
                s3.create_bucket(Bucket=bucket_name)
            else:
                s3.create_bucket(
                    Bucket=bucket_name,
                    CreateBucketConfiguration={"LocationConstraint": aws_region}
                )
        except Exception:
            # Bucket already exists or owned by user
            pass

        file_ext = "mp3" if "mp3" in mime_type else "wav" if "wav" in mime_type else "m4a" if "m4a" in mime_type else "webm"
        file_key = f"audio_input/{uuid.uuid4()}.{file_ext}"

        # Upload audio clip to AWS S3
        s3.put_object(Bucket=bucket_name, Key=file_key, Body=audio_bytes)
        media_uri = f"s3://{bucket_name}/{file_key}"

        # Trigger AWS Transcribe Job
        job_name = f"coolpath_job_{uuid.uuid4().hex[:8]}"
        transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": media_uri},
            MediaFormat=file_ext,
            LanguageCode="en-US"
        )

        # Poll AWS Transcribe for completion
        for _ in range(15):
            status = transcribe.get_transcription_job(TranscriptionJobName=job_name)
            job_status = status["TranscriptionJob"]["TranscriptionJobStatus"]
            if job_status in ["COMPLETED", "FAILED"]:
                if job_status == "COMPLETED":
                    transcript_uri = status["TranscriptionJob"]["Transcript"]["TranscriptFileUri"]
                    r = requests.get(transcript_uri, timeout=10)
                    if r.status_code == 200:
                        data = r.json()
                        raw_text = data["results"]["transcripts"][0]["transcript"]
                        
                        # Cleanup temp S3 object
                        try: s3.delete_object(Bucket=bucket_name, Key=file_key)
                        except Exception: pass

                        return raw_text.strip()
                break
            time.sleep(0.5)

    except Exception as e:
        logger.warning(f"AWS Transcribe error: {e}")

    return None
