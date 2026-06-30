"""Self-service account routes (profile, password, sessions)."""

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.services.admin_store import AdminStoreDep
from app.services.keycloak_account import (
    AccountServiceError,
    account_error_to_http,
    change_password,
    get_profile,
    list_sessions,
    realm_for_user,
    revoke_all_sessions,
    revoke_session,
    update_profile,
)

router = APIRouter(prefix="/account", tags=["account"])
_bearer = HTTPBearer(auto_error=False)


def _access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    if settings.auth_disabled:
        return "dev-token"
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return credentials.credentials


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


class AccountPasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=512)
    newPassword: str = Field(min_length=8, max_length=512)


class AccountSessionResponse(BaseModel):
    id: str | None = None
    ipAddress: str | None = None
    started: int | None = None
    lastAccess: int | None = None
    current: bool = False
    clients: list[dict] = Field(default_factory=list)


@router.get("/", response_model=AccountProfileResponse)
async def account_profile(
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> AccountProfileResponse:
    try:
        profile = await get_profile(token=token, claims=user, settings=settings)
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc
    return AccountProfileResponse(**profile)


@router.put("/profile", response_model=AccountProfileResponse)
async def account_update_profile(
    body: AccountProfileUpdateRequest,
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> AccountProfileResponse:
    try:
        profile = await update_profile(
            token=token,
            claims=user,
            settings=settings,
            first_name=body.firstName,
            last_name=body.lastName,
        )
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc
    return AccountProfileResponse(**profile)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def account_change_password(
    body: AccountPasswordChangeRequest,
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> None:
    try:
        await change_password(
            token=token,
            claims=user,
            settings=settings,
            current_password=body.currentPassword,
            new_password=body.newPassword,
        )
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc


@router.get("/sessions", response_model=list[AccountSessionResponse])
async def account_sessions(
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> list[AccountSessionResponse]:
    try:
        sessions = await list_sessions(token=token, claims=user, settings=settings)
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc
    return [AccountSessionResponse(**session) for session in sessions]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def account_revoke_session(
    session_id: str,
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> None:
    try:
        await revoke_session(token=token, claims=user, settings=settings, session_id=session_id)
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc


@router.post("/sessions/revoke-all", status_code=status.HTTP_204_NO_CONTENT)
async def account_revoke_all_sessions(
    user: dict = Depends(get_current_user),
    token: str = Depends(_access_token),
    settings: Settings = Depends(get_settings),
) -> None:
    try:
        await revoke_all_sessions(token=token, claims=user, settings=settings)
    except AccountServiceError as exc:
        raise account_error_to_http(exc) from exc


@router.post("/totp/request", status_code=status.HTTP_204_NO_CONTENT)
async def account_request_totp(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    store: AdminStoreDep,
) -> None:
    """Ask the user to configure TOTP on next sign-in (self-service)."""
    if settings.auth_disabled:
        return
    member_id = str(user.get("sub") or "")
    if not member_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing user id")
    realm = realm_for_user(user, settings)
    try:
        await store.enable_totp(realm, member_id, send_email=False)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not start TOTP setup",
        ) from exc
