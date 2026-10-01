"""SQLAlchemy models for admin-notifications storage."""

from __future__ import annotations

from sqlalchemy import BigInteger, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base


class AdminNotificationRow(Base):
    __tablename__ = "admin_notifications"
    __table_args__ = (
        Index("ix_admin_notifications_tenant_published_at", "tenant", "published_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    published_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tenant: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    body: Mapped[str] = mapped_column(String(4000), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    publisher: Mapped[str] = mapped_column(String(512), nullable=False)
    audience: Mapped[dict] = mapped_column(JSON, nullable=False)
    link_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    link_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class AdminNotificationDismissalRow(Base):
    __tablename__ = "admin_notification_dismissals"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_sub", name="uq_notification_dismissal"),
        Index("ix_admin_notification_dismissals_user_sub", "user_sub"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    notification_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_sub: Mapped[str] = mapped_column(String(255), nullable=False)
    dismissed_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
