from datetime import datetime, timezone

from sqlalchemy import String, Float, DateTime, JSON, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class ClusterTelemetryLog(Base):
    __tablename__ = "cluster_telemetry"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    node_name: Mapped[str] = mapped_column(String(100), index=True)
    cpu_usage_percent: Mapped[float] = mapped_column(Float)
    memory_usage_percent: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(50))
    anomaly_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
      DateTime(timezone=True),
      default=lambda: datetime.now(timezone.utc),
    )

    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="operator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
