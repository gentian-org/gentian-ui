from typing import Any

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_platform_superadmin,
    is_tenant_admin,
    normalize_groups,
)

router = APIRouter(prefix="/session", tags=["session"])


@router.get("/me")
def get_me(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    groups = normalize_groups(user)
    if settings.auth_disabled:
        groups = groups or ["gentian:tenant:demo:admins"]
    return {
        "sub": user.get("sub"),
        "username": user.get("preferred_username") or user.get("sub"),
        "name": user.get("name"),
        "email": user.get("email"),
        "tenant": user.get("tenant"),
        "groups": groups,
        "isPlatformAdmin": settings.auth_disabled or is_platform_superadmin(groups),
        "isTenantAdmin": settings.auth_disabled
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user),
    }
