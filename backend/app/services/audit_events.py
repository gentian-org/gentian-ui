"""Normalized audit event model for the Admin Console."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

AuditCategory = Literal["sign_in", "admin_action", "entitlement"]


@dataclass
class AuditEvent:
    id: str
    occurred_at: int
    category: AuditCategory
    action: str
    actor: str | None
    target: str | None
    tenant: str
    ip_address: str | None = None
    success: bool = True
    details: dict[str, str] = field(default_factory=dict)


@dataclass
class AuditEventFilters:
    user: str | None = None
    action: str | None = None
    category: AuditCategory | None = None
    from_epoch_ms: int | None = None
    to_epoch_ms: int | None = None
    limit: int = 200

    def normalized_limit(self) -> int:
        return max(1, min(self.limit, 500))
