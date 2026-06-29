"""Notification store factory."""

from __future__ import annotations

from typing import Annotated, Protocol

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.db.engine import init_portal_database
from app.services.admin_notifications import AdminNotification, NotificationAudience, NotificationSeverity
from app.services.memory_notification_store import MemoryNotificationStore
from app.services.sql_notification_store import SqlNotificationStore

_memory_notification_store: MemoryNotificationStore | None = None


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

    async def dismiss(self, notification_id: str, user_sub: str) -> None: ...

    async def get(self, notification_id: str) -> AdminNotification | None: ...


def _memory_store() -> MemoryNotificationStore:
    global _memory_notification_store
    if _memory_notification_store is None:
        _memory_notification_store = MemoryNotificationStore()
    return _memory_notification_store


def get_notification_store(settings: Settings = Depends(get_settings)) -> NotificationStore:
    if settings.database_url:
        init_portal_database(settings.database_url)
        return SqlNotificationStore()
    return _memory_store()


NotificationStoreDep = Annotated[NotificationStore, Depends(get_notification_store)]
