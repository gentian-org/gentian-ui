"""What the caller holds on this desktop's tenant, as the usher answered.

The claims carry the usher's answer (core/auth.py): the relations the caller
holds on the tenant, and the names of the tenant's positions they hold. No
token claim and no username decides anything here.
"""

from __future__ import annotations

from typing import Any

PLATFORM_TENANT = "platform"


def relations_of(user: dict[str, Any]) -> dict[str, bool]:
    rel = user.get("relations")
    return rel if isinstance(rel, dict) else {}


def positions_of(user: dict[str, Any]) -> list[str]:
    """The names of the tenant's positions the caller holds."""
    positions = user.get("positions")
    return [p for p in positions if isinstance(p, str)] if isinstance(positions, list) else []


def user_is_tenant_admin(user: dict[str, Any], tenant: str | None = None) -> bool:
    return bool(relations_of(user).get("can_administer")) and (tenant is None or tenant == user.get("tenant"))


def user_is_platform_admin(user: dict[str, Any]) -> bool:
    # The platform's administrators are the platform tenant's (AD-10):
    # can_administer there derives from admin on the cluster.
    return bool(relations_of(user).get("can_administer")) and user.get("tenant") == PLATFORM_TENANT
