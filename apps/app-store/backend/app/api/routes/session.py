"""Who is asking, and whether this app is for them.

The App Store app is for people who may install apps in the tenant. Whether
this person may is the director's answer (`can_install_app` in its `me`), and
the page is built from it. It is not what stops anybody: every step of an
install is asked of the director and the custodian again, with the same
token, and this app adds no authorisation of its own.
"""

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings
from app.core.problems import Refusal
from app.store import patterns

router = APIRouter(tags=["session"])
_bearer = HTTPBearer(auto_error=False)


async def _app_store_offered(settings: Settings, token: str) -> dict[str, Any] | None:
    """Whether the cluster offers an App Store at all: the usher says so
    beside the tiles. None when it could not be asked, which blocks nothing."""
    try:
        answer = await director.ask_usher(
            settings, f"/v1/tenants/{patterns.name(settings.tenant_id, 'tenant')}/tiles", token
        )
    except Refusal:
        return None
    offered = answer.body.get("appStore") if answer.ok and isinstance(answer.body, dict) else None
    if not isinstance(offered, dict) or not isinstance(offered.get("available"), bool):
        return None
    reason = offered.get("reason")
    return {
        "available": offered["available"],
        "reason": reason[:100] if isinstance(reason, str) else None,
    }


@router.get("/context")
async def context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    token = bearer_of(credentials)
    tenant = patterns.name(settings.tenant_id, "tenant")
    answer = await director.ask_director(settings, "GET", f"/v1/tenants/{tenant}/me", token)
    if answer.status == 403:
        # Not even entry to the tenant. The same page as "may not install".
        relations: dict[str, Any] = {}
    elif answer.status != 200 or not isinstance(answer.body, dict):
        raise answer.refusal()
    else:
        found = answer.body.get("relations")
        relations = found if isinstance(found, dict) else {}
    return {
        "tenant": tenant,
        "name": user.get("name") or user.get("preferred_username"),
        "mayInstall": relations.get("can_install_app") is True,
        "storeConfigured": settings.store_base is not None,
        "appStore": await _app_store_offered(settings, token),
        "adminConsoleUrl": settings.admin_console_url,
    }
