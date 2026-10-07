"""The store's catalogue, fetched here and served to the bundle.

The browser never asks a store anything. Every read below is made by this
process, anonymously -- no token, no tenant, no cluster -- and what comes
back is checked against the definition and handed on as data. Browsing needs
no store account, and signing in to the store changes nothing here.

Images are named by this API's own address (`app.store.media`): an image on
an origin the store's meta does not list has no address at all, and the
screen shows a placeholder.
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import language_of
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.store import media, patterns
from app.store.client import Store, get_store
from app.store.models import AppSummary

router = APIRouter(prefix="/store", tags=["catalogue"])

_EDITIONS = ("ce", "pe", "me", "ee")


def _store(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings)


def _summary(entry: AppSummary, origins: set[str]) -> dict[str, Any]:
    out = entry.model_dump(by_alias=True)
    out["iconUrl"] = media.proxied(entry.iconUrl, origins)
    return out


@router.get("/meta")
async def meta(
    _user: dict = Depends(get_current_user), store: Store = Depends(_store)
) -> dict[str, Any]:
    """What the screen needs of the store's description of itself. The
    issuer and the client id are this API's business and stay here."""
    found = await store.meta()
    return {
        "name": found.name,
        "apiVersion": found.apiVersion,
        "features": found.features,
        "languages": found.languages,
        "links": found.links.model_dump() if found.links else {},
    }


@router.get("/categories")
async def categories(
    request: Request, _user: dict = Depends(get_current_user), store: Store = Depends(_store)
) -> dict[str, Any]:
    items = await store.categories(language_of(request))
    return {"items": [c.model_dump() for c in items]}


@router.get("/apps")
async def apps(
    request: Request,
    category: str | None = Query(default=None),
    edition: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    _user: dict = Depends(get_current_user),
    store: Store = Depends(_store),
) -> dict[str, Any]:
    params: dict[str, str] = {"limit": str(limit)}
    if category:
        params["category"] = patterns.name(category, "category")
    if edition:
        if edition not in _EDITIONS:
            raise patterns.invalid("That is not an edition.")
        params["edition"] = edition
    if q and q.strip():
        params["q"] = q.strip()
    if cursor:
        params["cursor"] = patterns.cursor(cursor)
    items, next_cursor, omitted = await store.apps(params, language_of(request))
    origins = media.media_origins(await store.meta())
    return {
        "items": [_summary(entry, origins) for entry in items],
        "nextCursor": next_cursor,
        "omitted": omitted,
    }


@router.get("/apps/{catalogue}/{app}")
async def app(
    catalogue: str,
    app: str,
    request: Request,
    _user: dict = Depends(get_current_user),
    store: Store = Depends(_store),
) -> dict[str, Any]:
    detail = await store.app(catalogue, app, language_of(request))
    origins = media.media_origins(await store.meta())
    out = _summary(detail, origins)
    out["screenshots"] = [
        {**shot.model_dump(), "url": media.proxied(shot.url, origins)}
        for shot in detail.screenshots
    ]
    return out


@router.get("/apps/{catalogue}/{app}/reviews")
async def reviews(
    catalogue: str,
    app: str,
    request: Request,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    _user: dict = Depends(get_current_user),
    store: Store = Depends(_store),
) -> dict[str, Any]:
    params = {"limit": str(limit)}
    if cursor:
        params["cursor"] = patterns.cursor(cursor)
    summary, items, next_cursor = await store.reviews(catalogue, app, params, language_of(request))
    return {
        "summary": summary.model_dump(by_alias=True),
        "items": [r.model_dump() for r in items],
        "nextCursor": next_cursor,
    }


@router.get("/apps/{catalogue}/{app}/reports")
async def reports(
    catalogue: str,
    app: str,
    request: Request,
    _user: dict = Depends(get_current_user),
    store: Store = Depends(_store),
) -> dict[str, Any]:
    items = await store.reports(catalogue, app, language_of(request))
    return {"items": [r.model_dump() for r in items]}
