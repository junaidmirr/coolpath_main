from unittest.mock import patch

from app.config import GOOGLE_API_KEY, GOOGLE_OAUTH_TOKEN
from app.services import gcp_speech


def test_google_speech_credentials_are_environment_configuration():
    assert gcp_speech.GCP_API_KEY == GOOGLE_API_KEY
    assert gcp_speech.GCP_OAUTH_TOKEN == GOOGLE_OAUTH_TOKEN


def test_google_speech_missing_credentials_fails_without_request(monkeypatch):
    monkeypatch.setattr(gcp_speech, "GCP_API_KEY", "")
    monkeypatch.setattr(gcp_speech, "GCP_OAUTH_TOKEN", "")

    with patch.object(gcp_speech.requests, "post") as post:
        assert gcp_speech.transcribe_audio_gcp(b"audio") is None

    post.assert_not_called()


def test_google_speech_failure_log_does_not_include_response_body(monkeypatch, caplog):
    monkeypatch.setattr(gcp_speech, "GCP_API_KEY", "test-api-key")
    response_body = "provider response must not be logged"
    response = type("Response", (), {"status_code": 500, "text": response_body})()

    with patch.object(gcp_speech.requests, "post", return_value=response):
        assert gcp_speech.transcribe_audio_gcp(b"audio") is None

    assert response_body not in caplog.text
