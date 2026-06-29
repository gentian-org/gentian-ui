"""Helpers for recording Admin Console audit events from BFF routes."""

from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.services.audit_events import AuditCategory
from app.services.audit_store import audit_actor, get_audit_store


async def record_admin_audit(
    user: dict[str, Any],
    *,
    tenant: str,
    action: str,
    target: str | None = None,
    category: AuditCategory = "admin_action",
    success: bool = True,
    details: dict[str, str] | None = None,
) -> None:
    store = get_audit_store(get_settings())
    await store.record(
        tenant=tenant,
        category=category,
        action=action,
        actor=audit_actor(user),
        target=target,
        success=success,
        details=details,
    )
