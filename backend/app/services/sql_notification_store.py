"""PostgreSQL/SQLite persistence for admin notifications."""

from __future__ import annotations

import time
import uuid

from sqlalchemy import select

from app.db.engine import get_db_session
from app.models.admin_notification import AdminNotificationDismissalRow, AdminNotificationRow
from app.services.admin_notifications import (
    AdminNotification,
    NotificationAudience,
    NotificationSeverity,
)
from app.services.notification_audience import notification_visible_to_user


class SqlNotificationStore:
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
        row = AdminNotificationRow(
            id=notification.id,
            published_at=notification.published_at,
            tenant=notification.tenant,
            title=notification.title,
            body=notification.body,
            severity=notification.severity,
            publisher=notification.publisher,
            audience={
                "scope": audience.scope,
                "tenant": audience.tenant,
                "groups": audience.groups,
            },
            link_url=link_url,
            link_label=link_label,
            expires_at=expires_at,
        )
        with get_db_session() as session:
            session.add(row)
        return notification

    async def list_for_tenant(self, tenant: str) -> list[AdminNotification]:
        stmt = (
            select(AdminNotificationRow)
            .where(AdminNotificationRow.tenant == tenant)
            .order_by(AdminNotificationRow.published_at.desc())
        )
        with get_db_session() as session:
            rows = session.scalars(stmt).all()
            return [_row_to_notification(row) for row in rows]

    async def list_inbox(
        self,
        user: dict,
        *,
        user_tenant: str | None,
    ) -> list[AdminNotification]:
        user_sub = str(user.get("sub") or user.get("preferred_username") or "anonymous")
        with get_db_session() as session:
            rows = session.scalars(select(AdminNotificationRow)).all()
            dismissed = {
                row.notification_id
                for row in session.scalars(
                    select(AdminNotificationDismissalRow).where(
                        AdminNotificationDismissalRow.user_sub == user_sub
                    )
                ).all()
            }
            notifications = [_row_to_notification(row) for row in rows]

        visible: list[AdminNotification] = []
        for notification in notifications:
            if notification.id in dismissed:
                continue
            if notification_visible_to_user(notification, user, user_tenant=user_tenant):
                visible.append(notification)
        visible.sort(key=lambda item: item.published_at, reverse=True)
        return visible

    async def dismiss(self, notification_id: str, user_sub: str) -> None:
        with get_db_session() as session:
            existing = session.scalar(
                select(AdminNotificationDismissalRow).where(
                    AdminNotificationDismissalRow.notification_id == notification_id,
                    AdminNotificationDismissalRow.user_sub == user_sub,
                )
            )
            if existing:
                return
            session.add(
                AdminNotificationDismissalRow(
                    id=str(uuid.uuid4()),
                    notification_id=notification_id,
                    user_sub=user_sub,
                    dismissed_at=int(time.time() * 1000),
                )
            )

    async def get(self, notification_id: str) -> AdminNotification | None:
        with get_db_session() as session:
            row = session.get(AdminNotificationRow, notification_id)
            return _row_to_notification(row) if row else None


def _row_to_notification(row: AdminNotificationRow) -> AdminNotification:
    audience_data = row.audience or {}
    return AdminNotification(
        id=row.id,
        published_at=row.published_at,
        title=row.title,
        body=row.body,
        severity=row.severity,  # type: ignore[arg-type]
        audience=NotificationAudience(
            scope=audience_data.get("scope", "tenant"),
            tenant=audience_data.get("tenant"),
            groups=list(audience_data.get("groups") or []),
        ),
        publisher=row.publisher,
        tenant=row.tenant,
        link_url=row.link_url,
        link_label=row.link_label,
        expires_at=row.expires_at,
    )
