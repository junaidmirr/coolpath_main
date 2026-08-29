from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import app


client = TestClient(app)


def test_root_identifies_service_without_secrets():
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "service": "coolpath-backend",
        "status": "ok",
        "health": "/health",
        "readiness": "/ready",
    }
    assert "key" not in response.text.lower()
    assert "password" not in response.text.lower()
    assert "postgres" not in response.text.lower()


def test_health_remains_available():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_returns_200_when_database_is_available():
    with patch("app.db.database.engine.connect") as connect:
        connection = connect.return_value.__enter__.return_value

        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    connection.execute.assert_called_once()


def test_ready_returns_safe_503_when_database_is_unavailable():
    secret = "must-not-appear-in-readiness-response"
    database_error = OperationalError("SELECT 1", {}, RuntimeError(secret))

    with patch("app.db.database.engine.connect", side_effect=database_error):
        response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert secret not in response.text


def test_core_routes_are_registered_in_openapi():
    paths = client.get("/openapi.json").json()["paths"]

    for path in ("/", "/health", "/ready"):
        assert path in paths
        assert "get" in paths[path]
