"""Notification store factory."""

from __future__ import annotations

from typing import Annotated, Protocol

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.services.admin_notifications import AdminNotification, NotificationAudience, NotificationSeverity
from app.services.sql_notification_store import SqlNotificationStore


class NotificationStore(Protocol):
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
    ) -> AdminNotification: ...

    async def list_for_tenant(self, tenant: str) -> list[AdminNotification]: ...

    async def list_inbox(self, user: dict, *, user_tenant: str | None) -> list[AdminNotification]: ...

    async def dismiss(self, notification_id: str, user_sub: str, *, tenant: str) -> None: ...

    async def get(self, notification_id: str, *, tenant: str) -> AdminNotification | None: ...


def get_notification_store(settings: Settings = Depends(get_settings)) -> NotificationStore:
    return SqlNotificationStore()


NotificationStoreDep = Annotated[NotificationStore, Depends(get_notification_store)]
