"""Proxy to the gentian-os director, for what only it can answer.

Why a proxy rather than calling it from the browser
---------------------------------------------------
The director serves no CORS headers and lives on the cluster network. Routing
through here keeps it there, gives the console one origin, and means the
browser never holds a second audience's session.

What this deliberately does NOT do
----------------------------------
It holds no credential of its own and makes no authorisation decision. Every
request forwards the CALLER's bearer token, and the director decides -- from
the cluster relations in OpenFGA -- what that person may see. The tile list is
the answer to "which of these consoles may this person open", not to "is this
person an administrator", and that difference is the whole reason it is asked
here rather than computed in the console.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/cluster", tags=["cluster"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(15.0)


def _base_url(settings: Settings) -> str:
    url = getattr(settings, "director_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The director is not configured for this cluster.",
        )
    return url.rstrip("/")


def _cluster(settings: Settings) -> str:
    name = getattr(settings, "cluster_id", None)
    if not name:
        raise HTTPException(
            status_code=503,
            detail="This console does not know which cluster it belongs to.",
        )
    return name


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


@router.get("/tiles")
async def cluster_tiles(
    request: Request,
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
    usher = getattr(settings, "usher_url", None)
    if usher and settings.gentian_tenant:
        # The usher answers for one tenant, named in the path from this
        # desktop's own configuration and never from the browser, and is open
        # to whoever may enter that tenant.
        url = f"{usher.rstrip('/')}/v1/tenants/{settings.gentian_tenant}/tiles"
        params: dict = {}
        upstream_name = "The usher"
    else:
        # A cluster whose operator runs no usher yet: the director's route,
        # which answers only people holding a relation on the cluster.
        url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/tiles"
        # Which tenant's desktop this is, stated here and not taken from the
        # browser: the director leaves out other tenants' consoles, which sit
        # behind their own zone's session and would open onto a sign-in this
        # person has no account for.
        params = dict(request.query_params)
        params.pop("tenant", None)
        if settings.gentian_tenant:
            params["tenant"] = settings.gentian_tenant
        upstream_name = "The director"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {_token(credentials)}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"{upstream_name} is unreachable: {exc}",
        ) from exc

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
