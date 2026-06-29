"""In-memory admin notification store (no DATABASE_URL)."""

from __future__ import annotations

import time
import uuid
from copy import deepcopy

from app.services.admin_notifications import (
    AdminNotification,
    NotificationAudience,
    NotificationSeverity,
)
from app.services.notification_audience import notification_visible_to_user


class MemoryNotificationStore:
    def __init__(self) -> None:
        self._notifications: list[AdminNotification] = []
        self._dismissals: set[tuple[str, str]] = set()

    async def publish(
        self,
        *,
        tenant: str,
        title: str,
        body: str,
        severity: NotificationSeverity,
        audience: NotificationAudience,
        publisher: str,
        link_url: str | None = None,
        link_label: str | None = None,
        expires_at: int | None = None,
    ) -> AdminNotification:
        notification = AdminNotification(
            id=str(uuid.uuid4()),
            published_at=int(time.time() * 1000),
            title=title,
            body=body,
            severity=severity,
            audience=audience,
            publisher=publisher,
            tenant=tenant,
            link_url=link_url,
            link_label=link_label,
            expires_at=expires_at,
        )
        self._notifications.append(notification)
        return deepcopy(notification)

    async def list_for_tenant(self, tenant: str) -> list[AdminNotification]:
        items = [deepcopy(item) for item in self._notifications if item.tenant == tenant]
        items.sort(key=lambda item: item.published_at, reverse=True)
        return items

    async def list_inbox(
        self,
        user: dict,
        *,
        user_tenant: str | None,
    ) -> list[AdminNotification]:
        user_sub = str(user.get("sub") or user.get("preferred_username") or "anonymous")
        visible: list[AdminNotification] = []
        for item in self._notifications:
            if (item.id, user_sub) in self._dismissals:
                continue
            if notification_visible_to_user(item, user, user_tenant=user_tenant):
                visible.append(deepcopy(item))
        visible.sort(key=lambda item: item.published_at, reverse=True)
        return visible

    async def dismiss(self, notification_id: str, user_sub: str) -> None:
        self._dismissals.add((notification_id, user_sub))

    async def get(self, notification_id: str) -> AdminNotification | None:
        for item in self._notifications:
            if item.id == notification_id:
                return deepcopy(item)
        return None
