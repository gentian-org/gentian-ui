"""Admin notification domain types (admin-notifications contract)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

NotificationSeverity = Literal["info", "warning", "critical"]
AudienceScope = Literal["platform", "tenant"]

CLOUDEVENT_TYPE = "gentian.admin.notification.published.v1"


@dataclass
class NotificationAudience:
    scope: AudienceScope
    tenant: str | None = None
    groups: list[str] = field(default_factory=list)


@dataclass
class AdminNotification:
    id: str
    published_at: int
    title: str
    body: str
    severity: NotificationSeverity
    audience: NotificationAudience
    publisher: str
    tenant: str
    link_url: str | None = None
    link_label: str | None = None
    expires_at: int | None = None
