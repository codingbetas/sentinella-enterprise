import os

def pytest_configure(config):
    os.environ["SECRET_KEY"] = "test_secret"
    os.environ["POSTGRES_USER"] = "test"
    os.environ["POSTGRES_PASSWORD"] = "test"
    os.environ["POSTGRES_DB"] = "test"
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ["MODEL_PATH"] = "/tmp/test_model.joblib"
    # Dummy postgres URL
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@localhost:5432/testdb"