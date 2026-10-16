import os

from celery import Celery
from google import genai
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.ml_engine import detector
from app.models import ClusterTelemetryLog


# ============================================================
# CELERY CONFIGURATION
# ============================================================

CELERY_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL",
    "redis://redis:6379/0",
)

CELERY_RESULT_BACKEND = os.getenv(
    "CELERY_RESULT_BACKEND",
    "redis://redis:6379/0",
)

celery_app = Celery(
    "sentinella_worker",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
)

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not configured."
    )


# SQLAlchemy synchronous engine for Celery worker.
#
# Docker Compose provides:
# postgresql://user:password@db:5432/database
#
# psycopg2 is used here because this worker uses synchronous
# SQLAlchemy sessions.
if DATABASE_URL.startswith("postgresql+asyncpg://"):
    SYNC_DATABASE_URL = DATABASE_URL.replace(
        "postgresql+asyncpg://",
        "postgresql+psycopg2://",
        1,
    )

elif DATABASE_URL.startswith("postgresql://"):
    SYNC_DATABASE_URL = DATABASE_URL.replace(
        "postgresql://",
        "postgresql+psycopg2://",
        1,
    )

else:
    SYNC_DATABASE_URL = DATABASE_URL


sync_engine = create_engine(
    SYNC_DATABASE_URL,
    pool_pre_ping=True,
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
)


# ============================================================
# GEMINI SRE DIAGNOSIS
# ============================================================

def generate_sre_root_cause(
    node_name: str,
    cpu: float,
    ram: float,
) -> str:

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        return (
            "AI Diagnosis unavailable "
            "(GEMINI_API_KEY not found)"
        )

    try:

        client = genai.Client(
            api_key=api_key,
        )

        prompt = f"""
You are an expert Site Reliability Engineer (SRE)
AI assistant for Sentinella AIOps.

An anomaly was detected on infrastructure node
'{node_name}'.

Metrics:
- CPU Usage: {cpu}%
- Memory Usage: {ram}%

Provide a concise professional SRE incident report
containing:

1. Potential Root Cause.
2. Recommended Immediate Remediation Steps
   (2-3 bullet points).

Keep the response technical and under 4 sentences.
"""

        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
        )

        if response.text:
            return response.text.strip()

        return "AI Diagnosis unavailable (empty Gemini response)"

    except Exception as exc:
        return (
            "AI Diagnosis unavailable "
            f"(API Error: {exc})"
        )


# ============================================================
# DATABASE PERSISTENCE
# ============================================================

def _save_telemetry_to_db_sync(
    node_name: str,
    cpu: float,
    ram: float,
    status: str,
    anomaly_score: float,
    extra_metadata: dict,
    ai_analysis: str,
) -> int:

    with SyncSessionLocal() as session:

        db_item = ClusterTelemetryLog(
            node_name=node_name,
            cpu_usage_percent=cpu,
            memory_usage_percent=ram,
            status=status,
            anomaly_score=anomaly_score,
            extra_metadata=extra_metadata,
            ai_analysis=ai_analysis,
        )

        session.add(db_item)
        session.commit()
        session.refresh(db_item)

        return db_item.id


# ============================================================
# TELEMETRY PROCESSING TASK
# ============================================================

@celery_app.task(
    bind=True,
    name="worker.process_telemetry_task",
)
def process_telemetry_task(
    self,
    payload: dict,
):

    node_name = payload.get(
        "node_name",
        "unknown-node",
    )

    cpu = payload.get(
        "cpu_usage_percent",
    )

    ram = payload.get(
        "memory_usage_percent",
    )

    extra_metadata = dict(
        payload.get(
            "extra_metadata",
            {},
        ) or {}
    )

    # --------------------------------------------------------
    # Validate telemetry
    # --------------------------------------------------------

    if cpu is None or ram is None:
        raise ValueError(
            "Telemetry payload must contain "
            "cpu_usage_percent and "
            "memory_usage_percent."
        )

    cpu = float(cpu)
    ram = float(ram)

    # --------------------------------------------------------
    # 1. Isolation Forest anomaly detection
    # --------------------------------------------------------

    base_analysis = detector.predict(
        cpu,
        ram,
    )

    status = base_analysis["status"]

    anomaly_score = base_analysis[
        "anomaly_score"
    ]

    # --------------------------------------------------------
    # 2. Gemini SRE analysis
    #
    # Gemini is called ONLY when Isolation Forest
    # identifies an anomaly.
    # --------------------------------------------------------

    ai_analysis = status

    if base_analysis["is_anomaly"]:

        print(
            f"🚨 Anomaly confirmed on "
            f"{node_name}! "
            "Requesting SRE diagnosis..."
        )

        gemini_diagnosis = (
            generate_sre_root_cause(
                node_name,
                cpu,
                ram,
            )
        )

        ai_analysis = (
            f"{status} | "
            f"SRE Report: {gemini_diagnosis}"
        )

        extra_metadata[
            "ai_incident_report"
        ] = gemini_diagnosis

    # --------------------------------------------------------
    # 3. Worker logging
    # --------------------------------------------------------

    print(
        "[Async Celery Worker] "
        f"Node: {node_name} | "
        f"CPU: {cpu}% | "
        f"RAM: {ram}% | "
        f"Result: {ai_analysis}"
    )

    # --------------------------------------------------------
    # 4. Persist telemetry
    # --------------------------------------------------------

    try:

        log_id = (
            _save_telemetry_to_db_sync(
                node_name=node_name,
                cpu=cpu,
                ram=ram,
                status=status,
                anomaly_score=anomaly_score,
                extra_metadata=extra_metadata,
                ai_analysis=ai_analysis,
            )
        )

        print(
            "✅ Successfully persisted "
            f"telemetry log ID {log_id}"
        )

    except Exception as exc:

        print(
            "❌ Error saving telemetry "
            f"in background worker: {exc}"
        )

        raise

    # --------------------------------------------------------
    # 5. Return task result
    # --------------------------------------------------------

    return {
        "status": "success",
        "node_name": node_name,
        "telemetry_status": status,
        "is_anomaly": base_analysis[
            "is_anomaly"
        ],
        "anomaly_score": anomaly_score,
        "ai_analysis": ai_analysis,
        "database_log_id": log_id,
    }