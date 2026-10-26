"""The pictures tiles are drawn with, served from inside the cluster.

A tile shows the most specific picture there is (app/services/tile_store.py):
the person's own, else the tenant's for the app, else the profile's. Every
picture the desktop draws comes from this API or from the desktop's own
bundle; nothing is fetched from another origin when a tile is drawn.

    GET    /tiles/{tile}           the picture tile {tile} shows this person
    PUT    /person-tiles/{tile}    this person's own picture for tile {tile}
    DELETE /person-tiles/{tile}
    PUT    /tenant-tiles/{app}     the tenant's picture for app {app}
    DELETE /tenant-tiles/{app}

Who may set a tenant's tile
---------------------------
The App Store app's backend calls PUT and DELETE on /tenant-tiles directly on
the cluster network, not through the edge, with the person's own token. So
the token is verified here like any other (app/core/auth.py), no header that
names a person is read, and the caller must hold `can_install_app` on this
tenant as the director answers it: the relation an install is asked for, so
whoever may put an app on the tenant may give it its picture, and nobody else.
"""

import base64
import binascii
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.tenant import resolve_user_context
from app.services import tile_store
from app.services.tile_store import APP_NAME, MAX_TILE_BYTES, TILE_ID, Picture, TileRefused

router = APIRouter(tags=["tiles"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(10.0)
_PNG_DATA_URI = "data:image/png;base64,"
_GLYPH = r"[a-z0-9-]{1,63}"

AppName = Path(pattern=APP_NAME)
TileId = Path(pattern=TILE_ID)


def _refused(refusal: TileRefused) -> HTTPException:
    return HTTPException(status_code=refusal.status, detail=refusal.detail)


async def _body(request: Request) -> bytes:
    """The request body, refused as soon as it is larger than a tile may be."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_TILE_BYTES:
        raise HTTPException(status_code=413, detail="A tile is at most 1 MiB")
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_TILE_BYTES:
            raise HTTPException(status_code=413, detail="A tile is at most 1 MiB")
    return bytes(data)


def _content_type(request: Request) -> str:
    return request.headers.get("content-type", "").split(";", 1)[0].strip().lower()


def _picture(picture: Picture) -> Response:
    return Response(
        content=picture.data,
        media_type=picture.mime,
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


def _sub(user: dict) -> str:
    return str(user.get("sub") or "anonymous")


# ── the tenant's ────────────────────────────────────────────────────────────


def _require_install_right(user: dict, settings: Settings) -> None:
    if settings.auth_disabled:
        return
    relations = user.get("relations")
    if isinstance(relations, dict) and relations.get("can_install_app") is True:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Setting an app's tile for the tenant requires the right to install apps",
    )


@router.put("/tenant-tiles/{app}", status_code=status.HTTP_204_NO_CONTENT)
async def put_tenant_tile(
    request: Request,
    app: str = AppName,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    _require_install_right(user, settings)
    if _content_type(request) != tile_store.PNG:
        raise HTTPException(status_code=415, detail="A tenant's tile is sent as image/png")
    data = await _body(request)
    try:
        tile_store.check_tenant_tile(data)
    except TileRefused as refusal:
        raise _refused(refusal) from refusal
    tile_store.set_tenant_tile(resolve_user_context(user, settings), app, data, user.get("sub"))


@router.delete("/tenant-tiles/{app}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant_tile(
    app: str = AppName,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    _require_install_right(user, settings)
    tile_store.clear_tenant_tile(resolve_user_context(user, settings), app)


# ── a person's ──────────────────────────────────────────────────────────────


@router.put("/person-tiles/{tile_id:path}", status_code=status.HTTP_200_OK)
async def put_person_tile(
    request: Request,
    tile_id: str = TileId,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    """The picture this person chose for one of their tiles.

    Answers the address the desktop draws it from, versioned so a browser
    that cached the last one asks again.
    """
    data = await _body(request)
    try:
        mime = tile_store.check_person_tile(data, _content_type(request))
    except TileRefused as refusal:
        raise _refused(refusal) from refusal
    stamp = tile_store.set_person_tile(
        resolve_user_context(user, settings), _sub(user), tile_id, data, mime
    )
    return {"url": f"{settings.api_v1_str}/tiles/{tile_id}?v=p{stamp}"}


@router.delete("/person-tiles/{tile_id:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_person_tile(
    tile_id: str = TileId,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tile_store.clear_person_tile(resolve_user_context(user, settings), _sub(user), tile_id)


# ── which one a tile shows ──────────────────────────────────────────────────


async def _catalogue(token: str | None, settings: Settings) -> list[dict] | None:
    """The tiles the usher answers this person for this desktop's tenant, or
    None when it cannot be asked or does not answer."""
    if not settings.usher_url or not settings.gentian_tenant or not token:
        return None
    url = f"{settings.usher_url.rstrip('/')}/v1/tenants/{settings.gentian_tenant}/tiles"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            answer = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.RequestError:
        return None
    if answer.status_code != 200:
        return None
    try:
        tiles = answer.json().get("tiles") or []
    except (ValueError, AttributeError):
        return None
    return [t for t in tiles if isinstance(t, dict)] if isinstance(tiles, list) else None


def _names(tiles: list[dict]) -> list[str]:
    return [t["name"] for t in tiles if isinstance(t.get("name"), str)]


def _profile_picture(tile_id: str, tiles: list[dict] | None) -> Picture | str | None:
    """The profile's own picture for a tile, from the catalogue: PNG bytes,
    the name of one of the desktop's own glyphs, or None. A picture in any
    other form is not drawn."""
    icon = next(
        (t.get("icon") for t in tiles or [] if f"kernel-{t.get('name')}" == tile_id),
        None,
    )
    if not isinstance(icon, str):
        return None
    if icon.startswith(_PNG_DATA_URI):
        try:
            data = base64.b64decode(icon[len(_PNG_DATA_URI) :], validate=True)
        except (binascii.Error, ValueError):
            return None
        return Picture(data, tile_store.PNG) if tile_store.sniff(data) == tile_store.PNG else None
    return icon if re.fullmatch(_GLYPH, icon) else None


@router.get("/tiles/{tile_id:path}")
async def get_tile(
    tile_id: str = TileId,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The picture tile `tile_id` shows this person: theirs, else the
    tenant's for the app it is the main entry of, else the profile's."""
    tenant = resolve_user_context(user, settings)
    token = credentials.credentials if credentials else None
    tiles: list[dict] | None = None
    picture = tile_store.person_tile(tenant, _sub(user), tile_id)
    if picture is None and (app := tile_store.app_of(tile_id, tenant)) is not None:
        picture = tile_store.tenant_tile(tenant, app)
        # Off an app's main entry the tenant's picture is shown only where
        # the app has none, which the catalogue says.
        if picture is not None and not tile_store.is_main_entry(tile_id):
            tiles = await _catalogue(token, settings)
            if tiles is None or tile_store.pictured_app_of(tile_id, tenant, _names(tiles)) != app:
                picture = None
    if picture is not None:
        return _picture(picture)
    if tiles is None:
        tiles = await _catalogue(token, settings)
    default = _profile_picture(tile_id, tiles)
    if isinstance(default, Picture):
        return _picture(default)
    if isinstance(default, str):
        return RedirectResponse(f"/tiles/{default}.png", status_code=307)
    raise HTTPException(status_code=404, detail="This tile has no picture")
