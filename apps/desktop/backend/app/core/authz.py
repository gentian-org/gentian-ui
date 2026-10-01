"""Authorization helpers (OpenFGA / AuthZEN PEP).

Same API as gentian-app-template/backend/app/core/authz.py — see docs/SECURITY.md.
"""

from typing import Any, Callable

from fastapi import Depends, HTTPException, status

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    user_is_platform_admin,
)
from app.core.openfga_client import OpenFGAClient, user_subject


async def check_permission(
    *,
    user: dict[str, Any],
    relation: str,
    object_type: str,
    object_id: str,
    settings: Settings,
) -> None:
    client = OpenFGAClient(settings)
    allowed = await client.check(
        user=user_subject(user),
        relation=relation,
        object_type=object_type,
        object_id=object_id,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_permission(
    relation: str,
    object_type: str,
    object_id: str,
) -> Callable[..., Any]:
    """Dependency factory for route-level ReBAC checks (M22)."""

    async def _dependency(
        user: dict[str, Any] = Depends(get_current_user),
        settings: Settings = Depends(get_settings),
    ) -> dict[str, Any]:
        await check_permission(
            user=user,
            relation=relation,
            object_type=object_type,
            object_id=object_id,
            settings=settings,
        )
        return user

    return _dependency


def require_shell_launch() -> Callable[..., Any]:
    """PEP: tenant members may launch the Gentian shell app (Stage 1 exit criteria)."""

    async def _dependency(
        user: dict[str, Any] = Depends(get_current_user),
        settings: Settings = Depends(get_settings),
    ) -> dict[str, Any]:
        groups = normalize_groups(user)
        if (
            settings.auth_disabled
            or user_is_platform_admin(user)
            or is_tenant_admin(groups)
            or is_bootstrap_tenant_admin(user)
        ):
            return user
        await check_permission(
            user=user,
            relation="can_launch",
            object_type="shell_app",
            object_id="gentian-ui",
            settings=settings,
        )
        return user

    return _dependency
