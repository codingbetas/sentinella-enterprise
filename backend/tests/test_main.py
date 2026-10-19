from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app

client = TestClient(app)

def test_health_check():
    # We mock the database session just in case the app tries to query it
    with patch("app.database.get_db"):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"