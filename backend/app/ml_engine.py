import os

import joblib


MODEL_PATH = os.getenv(
    "MODEL_PATH",
    "/app/models/anomaly_model.joblib",
)


class TelemetryAnomalyDetector:
    def __init__(self):
        self.model = self._load_model()

    def _load_model(self):
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Anomaly model not found at {MODEL_PATH}. "
                "Run the training script first."
            )

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
