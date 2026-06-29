"""PostgreSQL/SQLite persistence for BFF-recorded admin audit events."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.db.engine import get_db_session
from app.models.admin_audit_event import AdminAuditEventRow
from app.services.audit_events import AuditCategory, AuditEvent, AuditEventFilters


class SqlAuditStore:
    async def record(
        self,
        *,
        tenant: str,
        category: AuditCategory,
        action: str,
        actor: str | None,
        target: str | None = None,
        ip_address: str | None = None,
        success: bool = True,
        details: dict[str, str] | None = None,
    ) -> AuditEvent:
        import time

        event = AuditEvent(
            id=str(uuid.uuid4()),
            occurred_at=int(time.time() * 1000),
            category=category,
            action=action,
            actor=actor,
            target=target,
            tenant=tenant,
            ip_address=ip_address,
            success=success,
            details=details or {},
        )
        row = AdminAuditEventRow(
            id=event.id,
            occurred_at=event.occurred_at,
            tenant=event.tenant,
            category=event.category,
            action=event.action,
            actor=event.actor,
            target=event.target,
            ip_address=event.ip_address,
            success=event.success,
            details=event.details,
        )
        with get_db_session() as session:
            session.add(row)
        return event

    async def list_events(self, tenant: str, filters: AuditEventFilters) -> list[AuditEvent]:
        fetch_limit = filters.normalized_limit()
        if filters.user or filters.action:
            fetch_limit = min(fetch_limit * 10, 500)

        stmt = (
            select(AdminAuditEventRow)
            .where(AdminAuditEventRow.tenant == tenant)
            .order_by(AdminAuditEventRow.occurred_at.desc())
            .limit(fetch_limit)
        )
        if filters.category:
            stmt = stmt.where(AdminAuditEventRow.category == filters.category)
        if filters.from_epoch_ms is not None:
            stmt = stmt.where(AdminAuditEventRow.occurred_at >= filters.from_epoch_ms)
        if filters.to_epoch_ms is not None:
            stmt = stmt.where(AdminAuditEventRow.occurred_at <= filters.to_epoch_ms)

        with get_db_session() as session:
            rows = session.scalars(stmt).all()

        events = _apply_text_filters([_row_to_event(row) for row in rows], filters)
        return events[: filters.normalized_limit()]


def _row_to_event(row: AdminAuditEventRow) -> AuditEvent:
    return AuditEvent(
        id=row.id,
        occurred_at=row.occurred_at,
        category=row.category,  # type: ignore[arg-type]
        action=row.action,
        actor=row.actor,
        target=row.target,
        tenant=row.tenant,
        ip_address=row.ip_address,
        success=row.success,
        details=dict(row.details or {}),
    )


def _apply_text_filters(events: list[AuditEvent], filters: AuditEventFilters) -> list[AuditEvent]:
    user_q = (filters.user or "").strip().lower()
    action_q = (filters.action or "").strip().lower()
    if not user_q and not action_q:
        return events

    filtered: list[AuditEvent] = []
    for event in events:
        if action_q and action_q not in event.action.lower():
            continue
        if user_q:
            haystack = " ".join(
                part
                for part in (event.actor, event.target, event.details.get("subject"))
                if part
            ).lower()
            if user_q not in haystack:
                continue
        filtered.append(event)
    return filtered
