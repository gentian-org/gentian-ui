"""A person's own account (names, sessions, second factor), through the registrar.

What this deliberately does NOT do
----------------------------------
It holds no credential and decides nothing, like the device passwords beside
it (devices.py). Every request forwards the CALLER's bearer token to the
registrar, which acts on the token's subject and nobody else (gentian-os
docs/concepts/iam.md §1.4a). Keycloak's own account API is not used: it takes
only a token made out to its account client, and the edge's token is not one.

The address is not changed here: it is where a password link is sent, and the
tenant's administrators change it. The password is not changed here either:
the realm's own pages do that, at sign-in.

The answers keep the shapes the account panel reads: times in epoch
milliseconds, a session's clients as ``[{"clientName": ...}]``.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.api.routes.devices import _ask, _relay, _service, _tenant, _token
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/account", tags=["account"])
_bearer = HTTPBearer(auto_error=False)


class AccountProfileResponse(BaseModel):
    email: str | None = None
    firstName: str = ""
    lastName: str = ""
    username: str | None = None
    totpConfigured: bool = False
    totpPending: bool = False


class AccountProfileUpdateRequest(BaseModel):
    firstName: str | None = Field(default=None, max_length=255)
    lastName: str | None = Field(default=None, max_length=255)


class AccountSessionResponse(BaseModel):
    id: str | None = None
    ipAddress: str | None = None
    started: int | None = None
    lastAccess: int | None = None
    current: bool = False
    clients: list[dict] = Field(default_factory=list)


def _registrar(settings: Settings) -> str:
    return f"{_service(settings.registrar_url, 'registrar')}/v1/tenants/{_tenant(settings)}"


def _dev_profile(user: dict) -> AccountProfileResponse:
    return AccountProfileResponse(
        email=user.get("email") or "dev@gentian.local",
        firstName="Dev",
        lastName="User",
        username=user.get("preferred_username") or "dev-user",
    )


def _profile(answer: dict) -> AccountProfileResponse:
    return AccountProfileResponse(
        email=answer.get("email") or None,
        firstName=answer.get("firstName") or "",
        lastName=answer.get("lastName") or "",
        username=answer.get("username") or None,
        totpConfigured=bool(answer.get("totpConfigured")),
        totpPending=bool(answer.get("totpRequired")) and not answer.get("totpConfigured"),
    )


def _millis(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _session(answer: dict) -> AccountSessionResponse:
    return AccountSessionResponse(
        id=answer.get("id"),
        ipAddress=answer.get("ipAddress"),
        started=_millis(answer.get("started")),
        lastAccess=_millis(answer.get("lastAccess")),
        current=bool(answer.get("current")),
        clients=[{"clientName": name} for name in answer.get("clients") or []],
    )


def _ok(upstream) -> dict:
    """The registrar's JSON answer, or its refusal as an HTTP error."""
    if upstream.status_code >= 400:
        try:
            detail = upstream.json().get("error") or upstream.text
        except ValueError:
            detail = upstream.text
        raise HTTPException(status_code=upstream.status_code, detail=detail)
    return upstream.json()


@router.get("/", response_model=AccountProfileResponse)
async def account_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AccountProfileResponse:
    if settings.auth_disabled:
        return _dev_profile(user)
    upstream = await _ask("GET", f"{_registrar(settings)}/account", _token(credentials))
    return _profile(_ok(upstream))


@router.put("/profile", response_model=AccountProfileResponse)
async def account_update_profile(
    body: AccountProfileUpdateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AccountProfileResponse:
    if settings.auth_disabled:
        return _dev_profile(user)
    upstream = await _ask(
        "POST",
        f"{_registrar(settings)}/actions/update-own-profile",
        _token(credentials),
        body.model_dump(exclude_none=True),
    )
    return _profile(_ok(upstream))


@router.get("/sessions", response_model=list[AccountSessionResponse])
async def account_sessions(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[AccountSessionResponse]:
    if settings.auth_disabled:
        return []
    upstream = await _ask("GET", f"{_registrar(settings)}/account/sessions", _token(credentials))
    return [_session(s) for s in _ok(upstream).get("sessions") or []]


@router.delete("/sessions/{session_id}", status_code=204)
async def account_revoke_session(
    session_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    url = f"{_registrar(settings)}/actions/end-own-session"
    return _relay(await _ask("POST", url, _token(credentials), {"id": session_id}))


@router.post("/sessions/revoke-all", status_code=204)
async def account_revoke_all_sessions(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    url = f"{_registrar(settings)}/actions/end-own-other-sessions"
    return _relay(await _ask("POST", url, _token(credentials)))
