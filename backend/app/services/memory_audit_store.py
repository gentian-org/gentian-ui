"""In-memory audit store for BFF-recorded admin actions (AUTH_DISABLED / v1)."""

from __future__ import annotations

import uuid
from copy import deepcopy

from app.services.audit_events import AuditCategory, AuditEvent, AuditEventFilters


class MemoryAuditStore:
    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

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
        occurred_at_ms: int | None = None,
    ) -> AuditEvent:
        import time

        event = AuditEvent(
            id=str(uuid.uuid4()),
            occurred_at=occurred_at_ms or int(time.time() * 1000),
            category=category,
            action=action,
            actor=actor,
            target=target,
            tenant=tenant,
            ip_address=ip_address,
            success=success,
            details=details or {},
        )
        self._events.append(event)
        return event

    async def list_events(self, tenant: str, filters: AuditEventFilters) -> list[AuditEvent]:
        events = [event for event in self._events if event.tenant == tenant]
        return self._apply_filters(events, filters)

    def _apply_filters(self, events: list[AuditEvent], filters: AuditEventFilters) -> list[AuditEvent]:
        filtered: list[AuditEvent] = []
        user_q = (filters.user or "").strip().lower()
        action_q = (filters.action or "").strip().lower()

        for event in events:
            if filters.category and event.category != filters.category:
                continue
            if filters.from_epoch_ms and event.occurred_at < filters.from_epoch_ms:
                continue
            if filters.to_epoch_ms and event.occurred_at > filters.to_epoch_ms:
                continue
            if user_q:
                haystack = " ".join(
                    part
                    for part in (event.actor, event.target, event.details.get("subject"))
                    if part
                ).lower()
                if user_q not in haystack:
                    continue
            if action_q and action_q not in event.action.lower():
                continue
            filtered.append(deepcopy(event))

        filtered.sort(key=lambda item: item.occurred_at, reverse=True)
        return filtered[: filters.normalized_limit()]
