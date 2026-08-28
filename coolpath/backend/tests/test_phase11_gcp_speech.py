import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.gcp_speech import transcribe_audio_gcp

def test_t111_gcp_speech_transcription_success():
    """Test successful Google Cloud Speech transcription parsing."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {
                "alternatives": [
                    {
                        "transcript": "take me to Central Park",
                        "confidence": 0.98
                    }
                ]
            }
        ]
    }

    with patch("requests.post", return_value=mock_response) as mock_post:
        transcript = transcribe_audio_gcp(b"fake_audio_bytes", "audio/wav")
        assert transcript == "take me to Central Park"
        mock_post.assert_called_once()
        print("✅ T11.1 PASSED — GCP Speech transcription success verified")

def test_t112_gcp_speech_transcription_empty_results():
    """Test GCP Speech transcription returning empty results handles gracefully."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": []
    }

    with patch("requests.post", return_value=mock_response):
        transcript = transcribe_audio_gcp(b"fake_audio_bytes", "audio/wav")
        assert transcript is None
        print("✅ T11.2 PASSED — GCP Speech transcription empty results handled gracefully")

def test_t113_gcp_speech_transcription_error():
    """Test GCP Speech transcription API error handling."""
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.text = "API Key Invalid"

    with patch("requests.post", return_value=mock_response):
        transcript = transcribe_audio_gcp(b"fake_audio_bytes", "audio/wav")
        assert transcript is None
        print("✅ T11.3 PASSED — GCP Speech transcription API error handled gracefully")
