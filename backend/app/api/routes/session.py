from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    user_is_platform_admin,
)
from app.core.shell_apps import shell_apps_for_user
from app.services.admin_store import AdminStoreDep
from app.core.tenant import resolve_user_context
from app.services.matrix_session_bridge import (
    create_matrix_bridge_ticket,
    is_allowed_app_origin,
    redeem_matrix_bridge_ticket,
)
from app.services.portal_session_bridge import (
    create_portal_bridge_ticket,
    is_allowed_tenant_origin,
    redeem_portal_bridge_ticket,
)
from app.services.openproject_session_bridge import (
    create_openproject_bridge_ticket,
    is_allowed_projects_origin,
    redeem_openproject_bridge_ticket,
)

router = APIRouter(prefix="/session", tags=["session"])


def _apply_matrix_bridge_cors(request: Request, response: Response, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin and is_allowed_app_origin(origin, settings):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"


def _apply_portal_bridge_cors(request: Request, response: Response, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin and is_allowed_tenant_origin(origin, settings):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"


def _apply_openproject_bridge_cors(request: Request, response: Response, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin and is_allowed_projects_origin(origin, settings):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"


@router.get("/me")
async def get_me(
    store: AdminStoreDep,
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
        "isPlatformAdmin": settings.auth_disabled or user_is_platform_admin(user),
        "isTenantAdmin": settings.auth_disabled
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user),
        "shellApps": await shell_apps_for_user(user, settings, store=store),
    }


@router.post("/matrix-bridge/ticket")
def create_matrix_bridge_ticket_route(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Mint a one-time ticket for chat.* to redeem into a Matrix session."""
    if settings.auth_disabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Matrix bridge is unavailable while auth is disabled",
        )

    tenant = resolve_user_context(user, settings)
    if tenant == settings.kernel_domain:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Matrix bridge is only available for tenant users",
        )

    ticket = create_matrix_bridge_ticket(user, tenant=tenant, settings=settings)
    return {"ticket": ticket}


@router.options("/matrix-bridge/redeem/{ticket}")
def redeem_matrix_bridge_preflight(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> Response:
    _apply_matrix_bridge_cors(request, response, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/matrix-bridge/redeem/{ticket}")
def redeem_matrix_bridge_route(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Redeem a portal-issued ticket on the chat.* origin (no portal cookie)."""
    _apply_matrix_bridge_cors(request, response, settings)
    return redeem_matrix_bridge_ticket(ticket, settings)


@router.post("/bridge/ticket")
def create_portal_bridge_ticket_route(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Mint a one-time ticket for embedded apps to redeem into a session."""
    if settings.auth_disabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Portal bridge is unavailable while auth is disabled",
        )

    tenant = resolve_user_context(user, settings)
    if tenant == settings.kernel_domain:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Portal bridge is only available for tenant users",
        )

    ticket = create_portal_bridge_ticket(user, tenant=tenant, settings=settings)
    return {"ticket": ticket}


@router.options("/bridge/redeem/{ticket}")
def redeem_portal_bridge_preflight(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> Response:
    _apply_portal_bridge_cors(request, response, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/bridge/redeem/{ticket}")
def redeem_portal_bridge_route(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Redeem a portal-issued ticket on the app origin (no portal cookie)."""
    _apply_portal_bridge_cors(request, response, settings)
    return redeem_portal_bridge_ticket(ticket, settings)


@router.post("/openproject-bridge/ticket")
def create_openproject_bridge_ticket_route(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    tenant = resolve_user_context(user, settings)
    if settings.auth_disabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenProject bridge is unavailable while auth is disabled",
        )

    if tenant == settings.kernel_domain:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OpenProject bridge is only available for tenant users",
        )

    ticket = create_openproject_bridge_ticket(user, tenant=tenant, settings=settings)
    return {"ticket": ticket}


@router.options("/openproject-bridge/redeem/{ticket}")
def redeem_openproject_bridge_preflight(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> Response:
    _apply_openproject_bridge_cors(request, response, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/openproject-bridge/redeem/{ticket}")
def redeem_openproject_bridge_route(
    ticket: str,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Redeem a portal-issued ticket on the projects.* origin (no portal cookie)."""
    _apply_openproject_bridge_cors(request, response, settings)
    return redeem_openproject_bridge_ticket(ticket, settings)


