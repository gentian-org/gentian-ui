"""Tenant apps, through the director.

These routes exist because the browser holds a session cookie, not a token: the
desktop's backend is where the person's access token is, so it is what forwards
it. They add nothing else. There is no scope check here and no role test — the
director makes the decision and these routes repeat its answer, status and
request id included, so a refusal can be found in the director's decision log.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services import director

router = APIRouter(prefix="/director", tags=["director"])
_bearer = HTTPBearer(auto_error=False)

# Names become path segments of the director's URL. The director validates them
# again; this only keeps a name from changing which URL is called.
_NAME = re.compile(r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")


def _token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials.credentials


def _name(value: str) -> str:
    if not _NAME.match(value):
        raise HTTPException(status_code=400, detail="invalid name")
    return value


async def _forward(request: Request, call: Any) -> Any:
    try:
        return await call
    except director.DirectorRefused as refused:
        headers = {"X-Request-Id": refused.request_id} if refused.request_id else None
        raise HTTPException(status_code=refused.status_code, detail=refused.detail, headers=headers) from refused
    except director.DirectorUnavailable as unavailable:
        raise HTTPException(status_code=503, detail=str(unavailable)) from unavailable


class InstallBody(BaseModel):
    coordinate: str | None = Field(default=None, description="store coordinate, <catalogue>/<app>")


class AddonsBody(BaseModel):
    addons: list[str]


class EntitlementBody(BaseModel):
    grant: str = Field(description="the store's statement, a compact JWS")


@router.get("/tenants/{tenant}/apps")
async def list_apps(tenant: str, request: Request, token: str = Depends(_token)) -> dict[str, Any]:
    apps = await _forward(request, director.list_apps(get_settings(), _name(tenant), token=token))
    return {"tenant": tenant, "apps": apps}


@router.post("/tenants/{tenant}/apps/{profile}", status_code=202)
async def install_app(
    tenant: str, profile: str, request: Request, body: InstallBody | None = None, token: str = Depends(_token)
) -> dict[str, Any]:
    return await _forward(
        request,
        director.install_app(
            get_settings(), _name(tenant), _name(profile), token=token, coordinate=body.coordinate if body else None
        ),
    )


@router.delete("/tenants/{tenant}/apps/{profile}", status_code=202)
async def uninstall_app(tenant: str, profile: str, request: Request, token: str = Depends(_token)) -> dict[str, Any]:
    return await _forward(request, director.uninstall_app(get_settings(), _name(tenant), _name(profile), token=token))


@router.get("/tenants/{tenant}/apps/{profile}/addons")
async def get_addons(tenant: str, profile: str, request: Request, token: str = Depends(_token)) -> dict[str, Any]:
    addons = await _forward(request, director.get_addons(get_settings(), _name(tenant), _name(profile), token=token))
    return {"profile": profile, "addons": addons}


@router.put("/tenants/{tenant}/apps/{profile}/addons", status_code=202)
async def set_addons(
    tenant: str, profile: str, body: AddonsBody, request: Request, token: str = Depends(_token)
) -> dict[str, Any]:
    return await _forward(
        request, director.set_addons(get_settings(), _name(tenant), _name(profile), body.addons, token=token)
    )


@router.get("/tenants/{tenant}/entitlements")
async def list_entitlements(tenant: str, request: Request, token: str = Depends(_token)) -> dict[str, Any]:
    facts = await _forward(request, director.list_entitlements(get_settings(), _name(tenant), token=token))
    return {"tenant": tenant, "entitlements": facts}


@router.post("/tenants/{tenant}/entitlements", status_code=202)
async def deliver_entitlement(
    tenant: str, body: EntitlementBody, request: Request, token: str = Depends(_token)
) -> dict[str, Any]:
    return await _forward(request, director.deliver_entitlement(get_settings(), _name(tenant), body.grant, token=token))


@router.get("/clusters/{cluster}/tiles")
async def kernel_tiles(cluster: str, request: Request, token: str = Depends(_token)) -> dict[str, Any]:
    """Tiles for the platform console: Headlamp, Argo CD, Keycloak — whichever
    the director says this person may see."""
    return await _forward(request, director.kernel_tiles(get_settings(), _name(cluster), token=token))
