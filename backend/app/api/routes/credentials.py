"""Proxy to the gentian-os Credential Manager.

Why a proxy rather than calling it from the browser
---------------------------------------------------
The Credential Manager serves no CORS headers, so a browser cannot reach it
directly. That is convenient rather than limiting: routing through here keeps the
service on the cluster network, gives the console one origin, and means the
browser never holds a second audience's session.

What this deliberately does NOT do
----------------------------------
It holds no credential of its own and makes no authorisation decision. Every
request forwards the CALLER's bearer token, and the Credential Manager exchanges
it with OpenBao — which decides what the caller may see and write, and records
the human in the audit device. A proxy that authenticated on its own behalf
would put a component with every permission between the user and the store,
which is the arrangement the service was designed to avoid.

So the only thing added here is transport. Status codes pass through unchanged,
including 428, which the console reads to render its danger zone.
"""

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
    url = getattr(settings, "credential_manager_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The credential manager is not configured for this cluster.",
        )
    return url.rstrip("/")


async def _forward(
    request: Request,
    method: str,
    path: str,
    token: str,
    settings: Settings,
    json_body: Any = None,
) -> Response:
    url = f"{_base_url(settings)}{path}"
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
            detail=f"The credential manager is unreachable: {exc}",
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


@router.put("/backup-identity")
async def escrow_backup_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Keep a copy of a workspace's backup key, so a lost download is not fatal.

    Forwarded rather than written here, for the same reason every other write on
    this router is: this service holds no OpenBao token. The credential manager
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
    body = await request.json()
    return await _forward(
        request, "PUT", f"/v1/repositories/{name}", _token(credentials), settings, body
    )


@router.delete("/repositories/{name}")
async def delete_repository(
    name: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await _forward(
        request, "DELETE", f"/v1/repositories/{name}", _token(credentials), settings
    )
