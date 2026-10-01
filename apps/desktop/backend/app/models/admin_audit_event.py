"""Persistent admin audit events recorded by the portal BFF."""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Index, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base


class AdminAuditEventRow(Base):
    __tablename__ = "admin_audit_events"
    __table_args__ = (
        Index("ix_admin_audit_events_tenant_occurred_at", "tenant", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    occurred_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tenant: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(512), nullable=True)
    target: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    details: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
