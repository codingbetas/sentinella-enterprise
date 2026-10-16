import os

import joblib
import numpy as np
from sqlalchemy import create_engine, text
from sklearn.ensemble import IsolationForest


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@db:5432/sentinelladb",
)

MODEL_PATH = os.getenv(
    "MODEL_PATH",
    "/app/models/anomaly_model.joblib",
)

MIN_TRAINING_SAMPLES = 20


def load_historical_telemetry():
    """
    Load historical telemetry that has been classified as normal.

    The model learns the normal operating baseline from these records.
    """

    engine = create_engine(DATABASE_URL)

    query = text("""
        SELECT
            cpu_usage_percent,
            memory_usage_percent
        FROM cluster_telemetry
        WHERE status = 'Normal 🟢'
          AND cpu_usage_percent IS NOT NULL
          AND memory_usage_percent IS NOT NULL
        ORDER BY timestamp ASC
    """)

    try:
        with engine.connect() as connection:
            rows = connection.execute(query).fetchall()
    finally:
        engine.dispose()

    if not rows:
        raise ValueError(
            "No historical normal telemetry found in the database."
        )

    X_train = np.array(rows, dtype=float)

    return X_train


def train_model():
    print("📊 Loading historical telemetry...")

    X_train = load_historical_telemetry()

    print(
        f"📈 Found {len(X_train)} normal telemetry records."
    )

    if len(X_train) < MIN_TRAINING_SAMPLES:
        raise ValueError(
            f"Not enough historical data for training. "
            f"Found {len(X_train)} records, "
            f"but at least {MIN_TRAINING_SAMPLES} are required."
        )

    print("🤖 Training Isolation Forest...")

    model = IsolationForest(
        contamination=0.05,
        random_state=42,
    )

    model.fit(X_train)

    os.makedirs(
        os.path.dirname(MODEL_PATH),
        exist_ok=True,
    )

    joblib.dump(model, MODEL_PATH)

    print(
        f"✅ Model trained using {len(X_train)} records."
    )

    print(
        f"💾 Model saved to: {MODEL_PATH}"
    )


if __name__ == "__main__":
    train_model()
