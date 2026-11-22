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
    # The tenant's positions the notice is for, by name.
    positions: list[str] = field(default_factory=list)
    # People the notice is for by name: each entry is a person's subject,
    # username or email address. Kept inside the stored audience, so a row
    # written before there were any reads as naming nobody.
    people: list[str] = field(default_factory=list)
    # What a row stored while audiences named groups still carries. Never
    # written; read only so that such a notice is shown to nobody rather than
    # to everybody (notification_audience.notification_visible_to_user).
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
