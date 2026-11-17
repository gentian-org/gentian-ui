"""A person's own device passwords, through the usher and the registrar.

A device password lets a calendar, contact or file program that knows only a
username and a password reach the tenant's door as the person, for the ways
the person chose (gentian-os docs/concepts/bridges.md).

What this deliberately does NOT do
----------------------------------
It holds no credential and decides nothing. Every request forwards the
CALLER's bearer token. The usher answers which ways the tenant's door serves
to apps this person may use; the registrar makes, lists and revokes the
person's own device passwords, and only theirs. A refusal comes back as it
was given -- including the registrar's step-up challenge (RFC 9470) when the
person's sign-in is too old to make a device password, which the page answers
by signing them in again.

The password is in the answer to the making and nowhere else: it is not
logged and not kept, and the answer is marked not to be stored.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core.auth import get_signed_in_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/account/devices", tags=["account"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(15.0)


def _tenant(settings: Settings) -> str:
    name = getattr(settings, "gentian_tenant", None)
    if not name:
        raise HTTPException(
            status_code=503, detail="This desktop does not know which tenant it belongs to."
        )
    return name


def _service(url: str | None, name: str) -> str:
    if not url:
        raise HTTPException(
            status_code=503, detail=f"The {name} is not configured for this cluster."
        )
    return url.rstrip("/")


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


async def _ask(method: str, url: str, token: str, body: dict | None = None) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            return await client.request(
                method, url, headers={"Authorization": f"Bearer {token}"}, json=body
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502, detail=f"{url.split('/v1/')[0]} is unreachable"
        ) from exc


def _relay(upstream: httpx.Response, *, no_store: bool = False) -> Response:
    """The service's answer as it came, with its challenge."""
    headers = {}
    if challenge := upstream.headers.get("www-authenticate"):
        headers["WWW-Authenticate"] = challenge
    if no_store:
        headers["Cache-Control"] = "no-store"
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
        headers=headers,
    )


@router.get("/door")
async def door(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tenant's door, and the ways at it this person may make a password for."""
    url = f"{_service(settings.usher_url, 'usher')}/v1/tenants/{_tenant(settings)}/door"
    return _relay(await _ask("GET", url, _token(credentials)))


@router.get("")
async def list_device_passwords(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """This person's device passwords, without their secrets."""
    url = f"{_service(settings.registrar_url, 'registrar')}/v1/tenants/{_tenant(settings)}/device-passwords"
    return _relay(await _ask("GET", url, _token(credentials)))


class CreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    ways: list[str] = Field(min_length=1, max_length=16)


@router.post("")
async def create_device_password(
    body: CreateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Makes a device password for this person; its secret is shown once."""
    base = _service(settings.registrar_url, "registrar")
    url = f"{base}/v1/tenants/{_tenant(settings)}/actions/create-device-password"
    return _relay(await _ask("POST", url, _token(credentials), body.model_dump()), no_store=True)


@router.delete("/{password_id}", status_code=204)
async def revoke_device_password(
    password_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_signed_in_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Revokes one of this person's device passwords."""
    base = _service(settings.registrar_url, "registrar")
    url = f"{base}/v1/tenants/{_tenant(settings)}/actions/revoke-device-password"
    return _relay(await _ask("POST", url, _token(credentials), {"id": password_id}))
