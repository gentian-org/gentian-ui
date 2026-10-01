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
    """The kernel consoles this person may open, as the director decides them.

    A person with no cluster relation gets an empty list rather than an error:
    holding nothing is an ordinary answer, and a console that showed a failure
    for it would be wrong for every tenant user.
    """
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/tiles"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.get(
                url,
                params=dict(request.query_params),
                headers={"Authorization": f"Bearer {_token(credentials)}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"The director is unreachable: {exc}",
        ) from exc

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
