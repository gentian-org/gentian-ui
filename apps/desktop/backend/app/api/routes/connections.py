"""A person's own connections to services outside the workspace, through the liaison.

A connection is a person's sign-in at an outside service -- Plaud, say --
that the agents they run call on their behalf (gentian-os
docs/concepts/control-plane.md, the liaison). The account panel's
Connections tab lists them and starts and ends them here.

What this deliberately does NOT do
----------------------------------
It holds no credential and decides nothing. Every request forwards the
CALLER's bearer token to the tenant's liaison, in the same namespace, which
accepts it for this and nothing more: no credential of the person's ever
comes back on it. A sign-in is started here and finished at the liaison's
own address, which sends the person back to this desktop.

A workspace whose apps name no outside service has no liaison. The list then
says so (``available: false``) and the panel shows no Connections tab.
"""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_signed_in_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/account/connections", tags=["account"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(15.0)
# What the liaison asks of every request that changes something.
_CHANGING = {"X-Liaison-Request": "1"}
# A connection is named after the agent bridge that names the service.
Name = Annotated[str, Path(pattern=r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")]


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


def _liaison(settings: Settings) -> str | None:
    url = getattr(settings, "liaison_url", None)
    return url.rstrip("/") if url else None


async def _ask(method: str, url: str, token: str, headers: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await client.request(
            method, url, headers={"Authorization": f"Bearer {token}", **(headers or {})}
        )


def _relay(upstream: httpx.Response) -> Response:
    """The liaison's answer as it came."""
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
        headers={"Cache-Control": "no-store"},
    )


def _unreachable() -> HTTPException:
    return HTTPException(status_code=502, detail="The liaison is unreachable.")


@router.get("", response_model=None)
async def list_connections(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response | dict:
    """This person's connections, and whether the workspace has a liaison at all."""
    base = _liaison(settings)
    if base is None:
        return {"available": False, "connections": []}
    try:
        upstream = await _ask("GET", f"{base}/api/v1/connections/", _token(credentials))
    except httpx.ConnectError:
        # No liaison in this namespace: its name does not resolve, or
        # nothing answers on it.
        return {"available": False, "connections": []}
    except httpx.RequestError as exc:
        raise _unreachable() from exc
    if upstream.status_code != 200:
        return _relay(upstream)
    body = upstream.json()
    return {"available": True, "connections": body.get("connections", [])}


@router.post("/{name}/connect")
async def connect(
    name: Name,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Starts this person's sign-in at the service; answers where to send them."""
    base = _liaison(settings)
    if base is None:
        raise HTTPException(status_code=404, detail="This workspace has no connections.")
    try:
        upstream = await _ask(
            "POST", f"{base}/api/v1/connections/{name}/connect", _token(credentials), _CHANGING
        )
    except httpx.RequestError as exc:
        raise _unreachable() from exc
    return _relay(upstream)


@router.post("/{name}/disconnect", status_code=204)
async def disconnect(
    name: Name,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Ends this person's connection to the service."""
    base = _liaison(settings)
    if base is None:
        raise HTTPException(status_code=404, detail="This workspace has no connections.")
    try:
        upstream = await _ask(
            "POST", f"{base}/api/v1/connections/{name}/disconnect", _token(credentials), _CHANGING
        )
    except httpx.RequestError as exc:
        raise _unreachable() from exc
    return _relay(upstream)
