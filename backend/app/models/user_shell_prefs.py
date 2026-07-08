"""Per-user shell preferences (wallpaper, future theme/base)."""

from __future__ import annotations

from sqlalchemy import Index, LargeBinary, String, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserShellPrefsRow(Base):
    __tablename__ = "user_shell_prefs"
    __table_args__ = (Index("ix_user_shell_prefs_tenant_user", "tenant", "user_sub"),)

    user_sub: Mapped[str] = mapped_column(String(128), primary_key=True)
    tenant: Mapped[str] = mapped_column(String(128), primary_key=True)
    background: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    background_mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prefs_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

