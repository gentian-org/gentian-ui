from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.authz import require_shell_launch
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    user_is_platform_admin,
)
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/apps", tags=["apps"])


def _shell_apps(user: dict, settings: Settings) -> list[dict]:
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


@router.get("/")
def list_apps(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    _authz: dict = Depends(require_shell_launch()),
) -> dict:
    return {"apps": _shell_apps(user, settings)}
