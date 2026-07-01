"""User-facing admin notification inbox (P7)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.tenant import extract_tenant_from_claims
from app.services.notification_audience import notification_visible_to_user
from app.services.notification_store import NotificationStoreDep

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationAudienceResponse(BaseModel):
    scope: Literal["platform", "tenant"]
    tenant: str | None = None
    groups: list[str] = Field(default_factory=list)


class InboxNotificationResponse(BaseModel):
    id: str
    publishedAt: int
    title: str
    body: str
    severity: Literal["info", "warning", "critical"]
    audience: NotificationAudienceResponse
    publisher: str
    tenant: str
    linkUrl: str | None = None
    linkLabel: str | None = None
    expiresAt: int | None = None


def _inbox_response(notification: Any) -> InboxNotificationResponse:
    return InboxNotificationResponse(
        id=notification.id,
        publishedAt=notification.published_at,
        title=notification.title,
        body=notification.body,
        severity=notification.severity,
        audience=NotificationAudienceResponse(
            scope=notification.audience.scope,
            tenant=notification.audience.tenant,
            groups=notification.audience.groups,
        ),
        publisher=notification.publisher,
        tenant=notification.tenant,
        linkUrl=notification.link_url,
        linkLabel=notification.link_label,
        expiresAt=notification.expires_at,
    )


def _user_tenant(user: dict[str, Any], settings: Settings) -> str | None:
    if settings.auth_disabled:
        return str(user.get("tenant") or "demo")
    return extract_tenant_from_claims(user) or user.get("tenant")


@router.get("/inbox", response_model=list[InboxNotificationResponse])
async def list_inbox(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: NotificationStoreDep,
) -> list[InboxNotificationResponse]:
    items = await store.list_inbox(user, user_tenant=_user_tenant(user, settings))
    return [_inbox_response(item) for item in items]


@router.post("/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_notification(
    notification_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    *,
    store: NotificationStoreDep,
) -> None:
    user_sub = str(user.get("sub") or user.get("preferred_username") or "anonymous")
    tenant = _user_tenant(user, settings)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant context required")
    notification = await store.get(notification_id, tenant=tenant)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if not notification_visible_to_user(
        notification,
        user,
        user_tenant=tenant,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Notification not in your inbox")
    await store.dismiss(notification_id, user_sub, tenant=tenant)
