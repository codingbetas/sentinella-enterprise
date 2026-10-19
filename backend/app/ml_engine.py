import os
import joblib
from sklearn.ensemble import IsolationForest
import numpy as np

MODEL_PATH = os.getenv(
    "MODEL_PATH",
    "/app/models/anomaly_model.joblib",
)

class TelemetryAnomalyDetector:
    def __init__(self):
        self.model = self._load_model()

    def _load_model(self):
        if not os.path.exists(MODEL_PATH):
            # If the model doesn't exist (like in GitHub Actions), 
            # create a dummy model so the tests don't crash.
            print(f"⚠️ Anomaly model not found at {MODEL_PATH}. Using dummy model for tests.")
            dummy_model = IsolationForest(contamination=0.1, random_state=42)
            dummy_model.fit(np.random.rand(10, 2)) # Fit on random data
            return dummy_model

        return joblib.load(MODEL_PATH)

    def predict(self, cpu: float, memory: float) -> dict:
        prediction = self.model.predict([[cpu, memory]])[0]
        score = self.model.decision_function([[cpu, memory]])[0]

        is_anomaly = bool(prediction == -1)

        return {
            "status": (
                "Anomaly Detected ⚠️"
                if is_anomaly
                else "Normal 🟢"
            ),
            "is_anomaly": is_anomaly,
            "anomaly_score": float(score),
        }


detector = TelemetryAnomalyDetector()