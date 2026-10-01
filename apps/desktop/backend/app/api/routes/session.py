"""Who is signed in, and what the shell may show them.

One read, and nothing else. The bridge tickets that used to live here are gone:
this service minted a one-time credential that an app redeemed into a session
of its own, which made the desktop a holder of authority and put it in the
trust path of every app that used it. Minting belongs where authority is
checked, and that is not here (gentian-os S7A.6).
"""

from typing import Any

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.gentian_groups import user_is_platform_admin, user_is_tenant_admin
from app.core.tenant import resolve_user_context

router = APIRouter(prefix="/session", tags=["session"])


@router.get("/me")
async def get_me(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Who is signed in, and what the director says they hold here.

    No tiles. `shellApps` used to be built by reading every AppProfile in the
    cluster through the Kubernetes API, which needed a ServiceAccount that could
    read cluster-scoped custom resources -- so the desktop held a cluster
    identity in order to draw a list of icons. The tiles come from the
    director's projected catalogue now, which the shell reads separately, and
    this process holds no Kubernetes credential at all (gentian-os S7A.6).

    No groups either: the director answers what the caller holds on this
    tenant, and a group in a token promotes nobody.
    """
    return {
        "sub": user.get("sub"),
        "username": user.get("preferred_username") or user.get("sub"),
        "name": user.get("name"),
        "email": user.get("email"),
        "tenant": resolve_user_context(user, settings),
        "groups": [],
        "relations": user.get("relations") or {},
        "isPlatformAdmin": settings.auth_disabled or user_is_platform_admin(user),
        "isTenantAdmin": settings.auth_disabled or user_is_tenant_admin(user),
        "shellApps": [],
    }
