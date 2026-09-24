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


async def _forward(
    method: str,
    url: str,
    token: str,
    *,
    params: dict[str, str] | None = None,
    json_body: object | None = None,
) -> Response:
    """Pass one request to the director as the caller and hand back its answer.

    Verbatim in both directions: the status the director chose, the body it
    wrote, nothing added. A 403 from it means the caller does not hold the
    relation, and turning that into a friendlier status here would be the
    console inventing an authorisation answer it is not entitled to give.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
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


@router.get("/settings")
async def cluster_settings(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What this cluster is configured with, and what of it may be changed.

    The director answers with the catalogue and the values together, so the
    screen is rendered from one response: what each setting means, what it
    accepts, and what it is now. The console adds no knowledge of its own --
    a setting it has never heard of still renders, and one the director drops
    disappears without a release here.
    """
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/settings"
    return await _forward("GET", url, _token(credentials))


@router.patch("/settings")
async def set_cluster_settings(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Change settings. One request is one commit to the deployments repository.

    202 with a commit means git has it and the cluster does not yet; 200 means
    the state asked for already held. The console shows that difference rather
    than pretending a save was the end of it.
    """
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/settings"
    return await _forward("PATCH", url, _token(credentials), json_body=body)


@router.get("/tenants")
async def cluster_tenants(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The customers this cluster carries, as the deployments repository has them.

    Read from git rather than from the cluster on purpose: a tenant whose
    manifest is committed but which the operator has not finished provisioning
    is still a tenant, and the screen should show it as committed rather than
    pretending it is not there yet.
    """
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/tenants"
    return await _forward("GET", url, _token(credentials))


@router.post("/tenants")
async def create_cluster_tenant(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Bring a tenant on. One request is one commit, with the caller as author."""
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/tenants"
    return await _forward("POST", url, _token(credentials), json_body=body)


@router.delete("/tenants/{tenant}")
async def retire_cluster_tenant(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Retire a tenant: git stops describing it, and Argo CD prunes what git
    no longer names. Whether the data goes with it is the manifest's
    deletionPolicy, which the operator honours and this does not decide."""
    url = f"{_base_url(settings)}/v1/clusters/{_cluster(settings)}/tenants/{tenant}"
    return await _forward("DELETE", url, _token(credentials))


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
