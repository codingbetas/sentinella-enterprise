from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "operator"


class TelemetryCreate(BaseModel):
    node_name: str
    cpu_usage_percent: float = Field(..., ge=0, le=100)
    memory_usage_percent: float = Field(..., ge=0, le=100)
    extra_metadata: dict[str, Any] | None = None


class TelemetryResponse(BaseModel):
    id: int
    node_name: str
    cpu_usage_percent: float
    memory_usage_percent: float
    status: str
    anomaly_score: float | None = None
    is_anomaly: bool
    timestamp: datetime
    ai_analysis: str | None = None
    ai_incident_report: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PasswordUpdateSchema(BaseModel):
    old_password: str
    new_password: str
