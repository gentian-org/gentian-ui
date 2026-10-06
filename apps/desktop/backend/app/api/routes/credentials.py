"""Proxy to the gentian-os Custodian.

Why a proxy rather than calling it from the browser
---------------------------------------------------
The custodian serves no CORS headers, so a browser cannot reach it
directly. That is convenient rather than limiting: routing through here keeps the
service on the cluster network, gives the console one origin, and means the
browser never holds a second audience's session.

What this deliberately does NOT do
----------------------------------
It holds no credential of its own and makes no authorisation decision. Every
request forwards the CALLER's bearer token, and the custodian exchanges
it with OpenBao — which decides what the caller may see and write, and records
the human in the audit device. A proxy that authenticated on its own behalf
would put a component with every permission between the user and the store,
which is the arrangement the service was designed to avoid.

So the only thing added here is transport. Status codes pass through unchanged,
including 428, which the console reads to render its danger zone.

Repositories are listed here and declared elsewhere. Which exist, and whether
each has its credential, is the custodian's list. Where one points is
configuration, so declaring or removing one is a commit the director makes --
the custodian has no route for it -- and those two routes relay there, for
this desktop's own tenant, with the same token.
"""

import re

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/credentials", tags=["credentials"])

_bearer = HTTPBearer(auto_error=False)

# Long enough for the OpenBao token exchange plus a validator probe, which can
# reach an external endpoint before the value is stored.
_TIMEOUT = httpx.Timeout(30.0)


def _base_url(settings: Settings) -> str:
    url = getattr(settings, "custodian_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The custodian is not configured for this cluster.",
        )
    return url.rstrip("/")


# A repository's name as the director accepts it. Checked here because it
# lands in a URL path.
_NAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

# What a declaration may say. The director refuses a body with any other
# field, so only these travel.
_DECLARATION = ("role", "type", "url", "branch", "writable", "confirm")


def _repository_url(settings: Settings, name: str) -> str:
    """The director's route for one repository of this desktop's tenant."""
    if not _NAME.match(name):
        raise HTTPException(
            status_code=400,
            detail="A repository's name is lower-case letters, digits and hyphens.",
        )
    director = getattr(settings, "director_url", None)
    if not director:
        raise HTTPException(
            status_code=503,
            detail="The director is not configured for this cluster: DIRECTOR_URL "
            "(the chart value director.url) is not set.",
        )
    tenant = getattr(settings, "gentian_tenant", None)
    if not tenant:
        raise HTTPException(
            status_code=503,
            detail="This desktop does not know which tenant it belongs to.",
        )
    return f"{director.rstrip('/')}/v1/tenants/{tenant}/repositories/{name}"


async def _forward(
    request: Request,
    method: str,
    path: str,
    token: str,
    settings: Settings,
    json_body: Any = None,
    *,
    url: str | None = None,
    service: str = "custodian",
) -> Response:
    """One request to the custodian at path, or to another service at url."""
    url = url or f"{_base_url(settings)}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.request(
                method,
                url,
                params=dict(request.query_params),
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"The {service} is unreachable: {exc}",
        ) from exc

    # Pass the status through untouched. 428 in particular carries the retype
    # requirement, and translating it here would mean encoding the danger rules
    # in a second place.
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


@router.get("")
async def list_credentials(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await _forward(request, "GET", "/v1/credentials", _token(credentials), settings)


# Declared before the "/{name}" catch-all below. FastAPI matches routes in
# registration order, so with that one first "PUT /credentials/backup-identity"
# was read as a credential named "backup-identity" and forwarded to
# /v1/credentials/backup-identity, which is not a requirement -- a 404 that
# looked like the endpoint was missing rather than shadowed.
@router.get("/backup-identity")
async def get_backup_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Whether this workspace already has an escrowed backup key, and which one.

    Metadata only. The upstream reads OpenBao's metadata endpoint, which does
    not carry the stored value, so the private half cannot come back through
    here. The public half can, and is what the form needs to offer "keep using
    the key you already have".
    """
    return await _forward(request, "GET", "/v1/backup-identity", _token(credentials), settings)


@router.put("/backup-identity")
async def escrow_backup_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Keep a copy of a workspace's backup key, so a lost download is not fatal.

    Forwarded rather than written here, for the same reason every other write on
    this router is: this service holds no OpenBao token. The custodian
    exchanges the caller's own, and the path it writes is derived from the tenant
    in the verified claim — so a workspace administrator can escrow into their
    own subtree and nowhere else, and that is a property of OpenBao's policy
    engine rather than of a check in this file.

    The key passes through this process in one request body and is not logged,
    stored, or echoed back; the upstream response carries metadata only.
    """
    body = await request.json()
    return await _forward(
        request, "PUT", "/v1/backup-identity", _token(credentials), settings, body
    )


@router.put("/{name}")
async def set_credential(
    name: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    body = await request.json()
    return await _forward(
        request, "PUT", f"/v1/credentials/{name}", _token(credentials), settings, body
    )


@router.get("/repositories/list")
async def list_repositories(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await _forward(request, "GET", "/v1/repositories", _token(credentials), settings)


@router.put("/repositories/{name}")
async def set_repository(
    name: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A commit at the director: 202, or 428 when the name must be retyped."""
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="The body is a repository declaration.")
    declaration = {k: body[k] for k in _DECLARATION if body.get(k) not in (None, "")}
    return await _forward(
        request,
        "PUT",
        "",
        _token(credentials),
        settings,
        declaration,
        url=_repository_url(settings, name),
        service="director",
    )


@router.delete("/repositories/{name}")
async def delete_repository(
    name: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Also a commit at the director; ?confirm= travels with the request."""
    return await _forward(
        request,
        "DELETE",
        "",
        _token(credentials),
        settings,
        url=_repository_url(settings, name),
        service="director",
    )
