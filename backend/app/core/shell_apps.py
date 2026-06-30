"""Shell launcher apps for the Gentian portal."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    user_is_platform_admin,
)


def shell_apps_for_user(user: dict[str, Any], settings: Settings) -> list[dict[str, Any]]:
    groups = normalize_groups(user)
    if settings.auth_disabled:
        groups = groups or ["gentian:tenant:demo:admins"]
    is_admin = (
        settings.auth_disabled
        or user_is_platform_admin(user)
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user)
    )

    if not is_admin:
        return []
    return [
        {
            "id": "admin",
            "title": "Admin Console",
            "icon": "admin",
            "launchUrl": None,
            "builtin": True,
        },
    ]
