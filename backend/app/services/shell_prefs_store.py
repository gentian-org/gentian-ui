"""Per-user shell preferences persisted in the tenant shell PostgreSQL database."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete

from app.db.tenant_engine import get_tenant_db_session
from app.models.user_shell_prefs import UserShellPrefsRow

MAX_BACKGROUND_BYTES = 5 * 1024 * 1024
ALLOWED_BACKGROUND_MIMES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}


@dataclass
class ShellPrefsSummary:
    has_background: bool
    prefs_json: dict | None


def get_summary(user_sub: str, tenant: str) -> ShellPrefsSummary:
    with get_tenant_db_session(tenant) as session:
        row = session.get(UserShellPrefsRow, {"user_sub": user_sub, "tenant": tenant})
        return ShellPrefsSummary(
            has_background=bool(row and row.background),
            prefs_json=row.prefs_json if (row and row.prefs_json) else {}
        )



def get_background(user_sub: str, tenant: str) -> tuple[bytes, str] | None:
    with get_tenant_db_session(tenant) as session:
        row = session.get(UserShellPrefsRow, {"user_sub": user_sub, "tenant": tenant})
        if row and row.background and row.background_mime:
            return row.background, row.background_mime
        return None


def set_background(user_sub: str, tenant: str, data: bytes, mime: str) -> None:
    if len(data) > MAX_BACKGROUND_BYTES:
        raise ValueError("Background image must be 5 MB or smaller")
    if mime not in ALLOWED_BACKGROUND_MIMES:
        raise ValueError("Unsupported image type")

    with get_tenant_db_session(tenant) as session:
        row = session.get(UserShellPrefsRow, {"user_sub": user_sub, "tenant": tenant})
        if row is None:
            row = UserShellPrefsRow(user_sub=user_sub, tenant=tenant)
            session.add(row)
        row.background = data
        row.background_mime = mime


def clear_background(user_sub: str, tenant: str) -> None:
    with get_tenant_db_session(tenant) as session:
        session.execute(
            delete(UserShellPrefsRow).where(
                UserShellPrefsRow.user_sub == user_sub,
                UserShellPrefsRow.tenant == tenant,
            )
        )
