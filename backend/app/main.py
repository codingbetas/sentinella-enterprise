import asyncio
import csv
import io
import json
import os
import platform
import time
from contextlib import asynccontextmanager
from typing import Annotated

import psutil
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .auth import (
    create_access_token,
    get_current_admin_user,
    get_current_user,
    hash_password,
    verify_password,
)
from .database import AsyncSessionLocal, engine, get_db
from .models import ClusterTelemetryLog, User
from .schemas import (
    PasswordUpdateSchema,
    TelemetryCreate,
    TelemetryResponse,
    UserCreate,
)
from .worker import process_telemetry_task
from .ml_engine import detector


# ============================================================
# INITIAL ADMIN CONFIGURATION
# ============================================================

DEFAULT_ADMIN_USERNAME = os.getenv(
    "DEFAULT_ADMIN_USERNAME",
    "admin",
)

DEFAULT_ADMIN_PASSWORD = os.getenv(
    "DEFAULT_ADMIN_PASSWORD",
)

if not DEFAULT_ADMIN_PASSWORD:
    print(
        "WARNING: DEFAULT_ADMIN_PASSWORD is not configured. "
        "A default admin account will not be created."
    )


# ============================================================
# APPLICATION LIFESPAN
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup/shutdown lifecycle.

    Database schema management is handled by Alembic.
    This lifecycle only handles default-admin initialization
    and SQLAlchemy engine cleanup.
    """

    # --------------------------------------------------------
    # STARTUP: Seed default admin
    # --------------------------------------------------------

    if DEFAULT_ADMIN_PASSWORD:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(User).where(
                    User.username == DEFAULT_ADMIN_USERNAME
                )
            )

            existing_admin = result.scalars().first()

            if not existing_admin:
                default_admin = User(
                    username=DEFAULT_ADMIN_USERNAME,
                    hashed_password=hash_password(
                        DEFAULT_ADMIN_PASSWORD
                    ),
                    role="admin",
                    is_active=True,
                )

                session.add(default_admin)
                await session.commit()

                print(
                    f">>> Default admin user "
                    f"'{DEFAULT_ADMIN_USERNAME}' created successfully!"
                )

    yield

    # --------------------------------------------------------
    # SHUTDOWN
    # --------------------------------------------------------

    await engine.dispose()


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="Sentinella Enterprise API",
    version="2.0.0",
    lifespan=lifespan,
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# GLOBAL SYSTEM STATE
# ============================================================

SYSTEM_STATE = {
    "processing_enabled": True,
    "last_modified_by": None,
}


# ============================================================
# AUTHENTICATION
# ============================================================

@app.post("/token")
async def login_for_access_token(
    form_data: Annotated[
        OAuth2PasswordRequestForm,
        Depends(),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    """
    Authenticate a user and issue a JWT access token.
    """

    result = await db.execute(
        select(User).where(
            User.username == form_data.username
        )
    )

    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    if not verify_password(
        form_data.password,
        user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={
                "WWW-Authenticate": "Bearer",
            },
        )

    access_token = create_access_token(
        data={
            "sub": user.username,
            "role": user.role,
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


# ============================================================
# PUBLIC REGISTRATION
# ============================================================

@app.post(
    "/auth/register",
    status_code=status.HTTP_201_CREATED,
)
async def register_operator(
    payload: UserCreate,
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    """
    Public registration.

    Public users are ALWAYS created as operators.
    """

    result = await db.execute(
        select(User).where(
            User.username == payload.username
        )
    )

    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    new_user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role="operator",
        is_active=True,
    )

    db.add(new_user)
    await db.commit()

    return {
        "message": "Operator account registered successfully",
        "username": new_user.username,
    }


# ============================================================
# ADMIN USER CREATION
# ============================================================

@app.post(
    "/admin/users",
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_user(
    payload: UserCreate,
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    admin: Annotated[
        dict,
        Depends(get_current_admin_user),
    ],
):
    """
    Create a user as an administrator.

    Only authenticated admins can access this endpoint.
    """

    result = await db.execute(
        select(User).where(
            User.username == payload.username
        )
    )

    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    requested_role = payload.role.lower()

    if requested_role not in {"admin", "operator"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be either 'admin' or 'operator'",
        )

    new_user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role=requested_role,
        is_active=True,
    )

    db.add(new_user)
    await db.commit()

    return {
        "message": (
            f"User created successfully "
            f"with role '{new_user.role}'"
        ),
        "created_by": admin["username"],
        "username": new_user.username,
    }


# ============================================================
# SYSTEM CONTROL
# ============================================================

@app.post("/system/control")
async def toggle_system_processing(
    enable: bool,
    admin: Annotated[
        dict,
        Depends(get_current_admin_user),
    ],
):
    """
    Enable or disable telemetry processing.

    Admin only.
    """

    SYSTEM_STATE["processing_enabled"] = enable
    SYSTEM_STATE["last_modified_by"] = admin["username"]

    status_msg = "RESUMED" if enable else "HALTED"

    return {
        "message": (
            f"System telemetry processing "
            f"has been {status_msg}."
        ),
        "modified_by": admin["username"],
        "control_state": SYSTEM_STATE,
    }


# ============================================================
# TELEMETRY INGESTION
# ============================================================

@app.post(
    "/telemetry/",
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_telemetry(
    payload: TelemetryCreate,
):
    """
    Queue telemetry processing through Celery.
    """

    if not SYSTEM_STATE["processing_enabled"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "System telemetry processing is "
                "currently halted by administrator."
            ),
        )

    task = process_telemetry_task.delay(
        payload.model_dump()
    )

    return {
        "message": "Telemetry payload accepted and queued",
        "task_id": task.id,
    }


# ============================================================
# AI DIAGNOSIS
# ============================================================

@app.post(
    "/ai/diagnose",
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_gemini_diagnosis(
    payload: TelemetryCreate,
):
    """
    Dispatch telemetry to the Celery worker.

    The worker runs Isolation Forest first and only calls
    Gemini when an anomaly is detected.
    """

    task = process_telemetry_task.delay(
        payload.model_dump()
    )

    return {
        "message": (
            "Gemini SRE deep diagnostic analysis queued."
        ),
        "task_id": task.id,
    }


# ============================================================
# TELEMETRY LOGS
# ============================================================

@app.get(
    "/telemetry/",
    response_model=list[TelemetryResponse],
)
async def get_telemetry_logs(
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    skip: int = 0,
    limit: int = 100,
):
    """
    Return telemetry records.
    """

    result = await db.execute(
        select(ClusterTelemetryLog)
        .order_by(
            ClusterTelemetryLog.timestamp.desc()
        )
        .offset(skip)
        .limit(limit)
    )

    logs = result.scalars().all()

    response = []

    for log in logs:

        metadata = (
            log.extra_metadata
            if isinstance(log.extra_metadata, dict)
            else {}
        )

        response.append(
            TelemetryResponse(
                id=log.id,
                node_name=log.node_name,
                cpu_usage_percent=log.cpu_usage_percent,
                memory_usage_percent=log.memory_usage_percent,
                status=log.status,
                anomaly_score=log.anomaly_score,
                is_anomaly=(
                    log.status == "Anomaly Detected ⚠️"
                ),
                timestamp=log.timestamp,
                ai_analysis=log.ai_analysis,
                ai_incident_report=metadata.get(
                    "ai_incident_report"
                ),
            )
        )

    return response



# ============================================================
# PASSWORD UPDATE
# ============================================================

@app.patch("/auth/password")
async def update_password(
    payload: PasswordUpdateSchema,
    current_user: Annotated[
        dict,
        Depends(get_current_user),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
):
    """
    Change the authenticated user's password.
    """

    result = await db.execute(
        select(User).where(
            User.username == current_user["username"]
        )
    )

    user = result.scalars().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    if not verify_password(
        payload.old_password,
        user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect existing password",
        )

    user.hashed_password = hash_password(
        payload.new_password
    )

    await db.commit()

    return {
        "message": "Password updated successfully"
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "backend-operational",
    }


# ============================================================
# WEBSOCKET CONNECTION MANAGER
# ============================================================

class ConnectionManager:

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(
        self,
        websocket: WebSocket,
    ):
        await websocket.accept()

        if websocket not in self.active_connections:
            self.active_connections.append(
                websocket
            )

    def disconnect(
        self,
        websocket: WebSocket,
    ):
        if websocket in self.active_connections:
            self.active_connections.remove(
                websocket
            )

    async def broadcast(
        self,
        message: str,
    ):
        disconnected = []

        for connection in self.active_connections:

            try:
                await connection.send_text(
                    message
                )

            except Exception:
                disconnected.append(
                    connection
                )

        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()

# ============================================================
# WEBSOCKET TELEMETRY
# ============================================================

@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(
    websocket: WebSocket,
    mode: str = "real",
):
    await manager.connect(websocket)

    print(
        f">>> WebSocket connected | mode={mode}"
    )

    try:
        while True:

            # ------------------------------------------------
            # PROCESSING DISABLED
            # ------------------------------------------------

            if not SYSTEM_STATE["processing_enabled"]:
                await asyncio.sleep(1)
                continue

            # ------------------------------------------------
            # SIMULATED MODE
            # ------------------------------------------------

            if mode.lower() == "simulated":

                t = asyncio.get_event_loop().time()

                cpu_sim = round(
                    float(t % 60 + 20),
                    2,
                )

                ram_sim = 65.4

                ai_result = detector.predict(
                    cpu_sim,
                    ram_sim,
                )

                data = {
                    "node_name": "simulated-test-node",

                    "cpu_usage_percent": cpu_sim,

                    "memory_usage_percent": ram_sim,

                    "status": (
                        "Critical"
                        if (
                            cpu_sim > 75
                            or ai_result["is_anomaly"]
                        )
                        else "Healthy"
                    ),

                    "mode": "simulated",

                    "os": "Simulated OS",

                    "top_processes": [
                        {
                            "pid": None,
                            "name": "mock-process",
                            "memory_percent": 12.5,
                            "cpu_percent": 5.0,
                            "username": "simulated",
                        }
                    ],

                    "timestamp": time.strftime(
                        "%Y-%m-%dT%H:%M:%S"
                    ),

                    "ai_analysis": ai_result["status"],

                    "anomaly_score": (
                        ai_result["anomaly_score"]
                    ),

                    "is_anomaly": (
                        ai_result["is_anomaly"]
                    ),

                    "ai_incident_report": (
                        "Simulated environment operating "
                        "within nominal synthetic parameters."
                        if not ai_result["is_anomaly"]
                        else (
                            "Simulated synthetic load spike "
                            "detected by Isolation Forest model."
                        )
                    ),
                }

            # ------------------------------------------------
            # REAL MODE
            # ------------------------------------------------

            else:

                cpu_total = psutil.cpu_percent(
                    interval=None
                )

                ram = psutil.virtual_memory()

                top_processes = []

                # --------------------------------------------
                # GET TOP PROCESSES
                # --------------------------------------------

                try:
                    processes = sorted(
                        psutil.process_iter(
                            [
                                "pid",
                                "name",
                                "memory_percent",
                                "cpu_percent",
                                "username",
                            ],
                            ad_value=None,
                        ),
                        key=lambda p: (
                            p.info.get(
                                "memory_percent"
                            )
                            or 0.0
                        ),
                        reverse=True,
                    )[:5]

                    for proc in processes:
                        try:
                            top_processes.append(
                                {
                                    "pid": proc.info.get(
                                        "pid"
                                    ),

                                    "name": (
                                        proc.info.get(
                                            "name"
                                        )
                                        or "Unknown"
                                    ),

                                    "memory_percent": round(
                                        float(
                                            proc.info.get(
                                                "memory_percent"
                                            )
                                            or 0.0
                                        ),
                                        2,
                                    ),

                                    "cpu_percent": round(
                                        float(
                                            proc.info.get(
                                                "cpu_percent"
                                            )
                                            or 0.0
                                        ),
                                        2,
                                    ),

                                    "username": (
                                        proc.info.get(
                                            "username"
                                        )
                                        or "Unknown"
                                    ),
                                }
                            )

                        except (
                            psutil.NoSuchProcess,
                            psutil.AccessDenied,
                            psutil.ZombieProcess,
                        ):
                            continue

                except Exception as process_error:

                    print(
                        "Process telemetry error:",
                        process_error,
                    )

                    top_processes = []

                # --------------------------------------------
                # AI / ANOMALY DETECTION
                # --------------------------------------------

                ai_result = detector.predict(
                    cpu_total,
                    ram.percent,
                )

                incident_report = (
                    "System operating normally. "
                    "No telemetry anomalies flagged."
                )

                if ai_result["is_anomaly"]:
                    incident_report = (
                        "Isolation Forest flagged outlier "
                        "metrics. "
                        f"CPU: {cpu_total}%, "
                        f"RAM: {ram.percent}%. "
                        "Recommended action: Inspect "
                        "high-memory or high-CPU processes."
                    )

                # --------------------------------------------
                # SYSTEM STATUS
                # --------------------------------------------

                system_status = (
                    "Critical"
                    if (
                        cpu_total > 85
                        or ram.percent > 85
                        or ai_result["is_anomaly"]
                    )
                    else "Healthy"
                )

                # --------------------------------------------
                # RESPONSE
                # --------------------------------------------

                data = {
                    "node_name": "host-workstation-live",

                    "cpu_usage_percent": cpu_total,

                    "memory_usage_percent": ram.percent,

                    "status": system_status,

                    "mode": "real",

                    "os": (
                        f"{platform.system()} "
                        f"{platform.release()}"
                    ),

                    "top_processes": top_processes,

                    "timestamp": time.strftime(
                        "%Y-%m-%dT%H:%M:%S"
                    ),

                    "ai_analysis": ai_result["status"],

                    "anomaly_score": (
                        ai_result["anomaly_score"]
                    ),

                    "is_anomaly": (
                        ai_result["is_anomaly"]
                    ),

                    "ai_incident_report": incident_report,
                }

            # ------------------------------------------------
            # SEND TELEMETRY
            # ------------------------------------------------

            await websocket.send_text(
                json.dumps(data)
            )

            await asyncio.sleep(3)

    except WebSocketDisconnect:
        print(
            f">>> WebSocket disconnected | mode={mode}"
        )

    except Exception as exc:
        print(
            f">>> WebSocket telemetry error: {exc}"
        )

    finally:
        manager.disconnect(websocket)


# ============================================================
# ADMIN REPORT EXPORT
# ============================================================

@app.get("/admin/export-reports")
async def export_admin_reports(
    admin: Annotated[
        dict,
        Depends(get_current_admin_user),
    ],
    db: Annotated[
        AsyncSession,
        Depends(get_db),
    ],
    format: str = Query(
        "json",
        pattern="^(json|csv|txt)$",
    ),
):
    """
    Export the latest 500 telemetry records.

    Admin only.
    """

    result = await db.execute(
        select(ClusterTelemetryLog)
        .order_by(
            ClusterTelemetryLog.timestamp.desc()
        )
        .limit(500)
    )

    db_logs = result.scalars().all()

    logs = [
        {
            "id": log.id,
            "node_name": log.node_name,
            "timestamp": str(log.timestamp),
            "cpu_usage_percent": (
                log.cpu_usage_percent
            ),
            "memory_usage_percent": (
                log.memory_usage_percent
            ),
            "status": log.status,
            "anomaly_score": log.anomaly_score,
            "ai_analysis": log.ai_analysis,
            "extra_metadata": log.extra_metadata,
        }
        for log in db_logs
    ]

    if not logs:
        logs = [
            {
                "message": (
                    "No telemetry or incident "
                    "records found in database."
                )
            }
        ]

    # --------------------------------------------------------
    # JSON
    # --------------------------------------------------------

    if format == "json":

        json_data = json.dumps(
            logs,
            indent=2,
            default=str,
        )

        return StreamingResponse(
            io.BytesIO(
                json_data.encode("utf-8")
            ),
            media_type="application/json",
            headers={
                "Content-Disposition": (
                    "attachment; "
                    "filename="
                    "sentinella_audit_report.json"
                )
            },
        )

    # --------------------------------------------------------
    # CSV
    # --------------------------------------------------------

    if format == "csv":

        output = io.StringIO()

        writer = csv.writer(output)

        writer.writerow(
            [
                "ID",
                "Node Name",
                "Timestamp",
                "CPU (%)",
                "Memory (%)",
                "Status",
                "Anomaly Score",
                "AI Analysis",
            ]
        )

        for log in logs:

            if "message" in log:
                writer.writerow(
                    [log["message"]]
                )
                continue

            writer.writerow(
                [
                    log.get("id"),
                    log.get("node_name"),
                    log.get("timestamp"),
                    log.get("cpu_usage_percent"),
                    log.get("memory_usage_percent"),
                    log.get("status"),
                    log.get("anomaly_score"),
                    log.get("ai_analysis"),
                ]
            )

        output.seek(0)

        return StreamingResponse(
            io.BytesIO(
                output.getvalue().encode("utf-8")
            ),
            media_type="text/csv",
            headers={
                "Content-Disposition": (
                    "attachment; "
                    "filename="
                    "sentinella_audit_report.csv"
                )
            },
        )

    # --------------------------------------------------------
    # TXT
    # --------------------------------------------------------

    text_content = (
        "=== SENTINELLA ENTERPRISE "
        "AIOPS AUDIT & INCIDENT REPORT ===\n"
    )

    text_content += (
        f"Generated By Admin: "
        f"{admin['username']}\n"
    )

    text_content += (
        f"Export Timestamp: "
        f"{time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    )

    for idx, log in enumerate(logs, 1):

        text_content += (
            f"--- Incident Record #{idx} ---\n"
        )

        text_content += (
            f"Node Name     : "
            f"{log.get('node_name', 'N/A')}\n"
        )

        text_content += (
            f"Timestamp     : "
            f"{log.get('timestamp', 'N/A')}\n"
        )

        text_content += (
            f"CPU / RAM     : "
            f"{log.get('cpu_usage_percent', 'N/A')}% / "
            f"{log.get('memory_usage_percent', 'N/A')}%\n"
        )

        text_content += (
            f"System Status : "
            f"{log.get('status', 'N/A')}\n"
        )

        text_content += (
            f"Anomaly Score : "
            f"{log.get('anomaly_score', 'N/A')}\n"
        )

        text_content += (
            f"AI Analysis   : "
            f"{log.get('ai_analysis', 'N/A')}\n"
        )

        text_content += "\n"

    return StreamingResponse(
        io.BytesIO(
            text_content.encode("utf-8")
        ),
        media_type="text/plain",
        headers={
            "Content-Disposition": (
                "attachment; "
                "filename="
                "sentinella_audit_report.txt"
            )
        },
    )
