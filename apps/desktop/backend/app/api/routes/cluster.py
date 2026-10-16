"""Proxy to the usher, for what only it can answer.

Why a proxy rather than calling it from the browser
---------------------------------------------------
The usher has no public route and lives on the cluster network. Routing
through here keeps it there and gives the desktop one origin.

What this deliberately does NOT do
----------------------------------
It holds no credential of its own and makes no authorisation decision. Every
request forwards the CALLER's bearer token, and the usher decides -- from that
person's relations in OpenFGA -- which tiles they may open. Nothing is
substituted when it cannot be asked: a desktop with no usher configured, or
one that is unreachable, answers with the failure.

What it does change
-------------------
One thing, and only in an answer the usher gave with 200: the picture of an
app's main tile, when the tenant holds one for that app (the App Store's,
app/api/routes/tiles.py). The tile then names this API's own address for it,
versioned by when it was set. Which tiles there are, and everything else
about them, is the usher's answer as it came.
"""

import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.services import tile_store

router = APIRouter(prefix="/cluster", tags=["cluster"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(15.0)
_log = logging.getLogger(__name__)


def _usher_url(settings: Settings) -> str:
    url = getattr(settings, "usher_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The usher is not configured for this cluster.",
        )
    return url.rstrip("/")


def _tenant(settings: Settings) -> str:
    name = getattr(settings, "gentian_tenant", None)
    if not name:
        raise HTTPException(
            status_code=503,
            detail="This desktop does not know which tenant it belongs to.",
        )
    return name


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


@router.get("/tiles")
async def cluster_tiles(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tiles this person may open on this desktop.

    Asked of the usher, which answers anybody who may enter the tenant and
    filters each tile by that person's own relation. A person who may open
    nothing gets an empty list rather than an error: holding nothing is an
    ordinary answer.
    """
    # The tenant is this desktop's own, from its configuration and never from
    # the browser. With no usher or no tenant configured this answers 503:
    # an empty desktop would look like a person who holds nothing.
    url = f"{_usher_url(settings)}/v1/tenants/{_tenant(settings)}/tiles"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.get(
                url,
                headers={"Authorization": f"Bearer {_token(credentials)}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"The usher is unreachable: {exc}",
        ) from exc

    content = upstream.content
    if upstream.status_code == 200:
        content = _with_tenant_pictures(content, _tenant(settings), settings)
    return Response(
        content=content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


def _with_tenant_pictures(content: bytes, tenant: str, settings: Settings) -> bytes:
    """The usher's answer, with each main tile the tenant has a picture for
    pointing at it. A picture that cannot be looked up leaves the answer as
    it came: the profile's own picture is a tile, a missing tile list is not."""
    try:
        versions = tile_store.tenant_tile_versions(tenant)
    except Exception as exc:  # noqa: BLE001 -- the tiles matter more than their pictures
        _log.warning("tenant tile pictures could not be read: %s", exc)
        return content
    if not versions:
        return content
    try:
        body = json.loads(content)
    except ValueError:
        return content
    tiles = body.get("tiles") if isinstance(body, dict) else None
    if not isinstance(tiles, list):
        return content
    for tile in tiles:
        if not isinstance(tile, dict) or not isinstance(tile.get("name"), str):
            continue
        tile_id = f"kernel-{tile['name']}"
        app = tile_store.main_app_of(tile_id, tenant)
        if app is not None and app in versions:
            tile["icon"] = f"{settings.api_v1_str}/tiles/{tile_id}?v=t{versions[app]}"
    return json.dumps(body).encode()
