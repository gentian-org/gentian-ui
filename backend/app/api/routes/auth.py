"""Unauthenticated auth helpers for the portal login page."""

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.login_routing import resolve_login_route
from app.services.keycloak_idp_session import create_idp_session_redirect
from app.services.admin_store import AdminStoreDep, admin_store_configured
from app.services.keycloak_password_login import LoginFailedError, password_login

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=512)


class LoginResponse(BaseModel):
    accessToken: str
    idToken: str | None = None
    realm: str
    kind: str


class IdpSessionResponse(BaseModel):
    redirectUrl: str | None = None
    skipped: bool = False


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get("/login-route")
def login_route(
    email: str = Query(..., min_length=3, max_length=320),
    settings: Settings = Depends(get_settings),
) -> dict[str, str | None]:
    """Resolve email → tenant realm for Gentian login."""
    try:
        route = resolve_login_route(
            email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "loginHint": route.login_hint,
        "idpHint": route.idp_hint,
        "kind": route.kind,
    }


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
) -> LoginResponse:
    """Authenticate with email/password on the Gentian login page (no Keycloak redirect)."""
    try:
        route = resolve_login_route(
            body.email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    realm = settings.kernel_realm if route.idp_hint is None else route.idp_hint
    if admin_store_configured(settings):
        try:
            await store.restore_workspace_email_for_login(realm, route.keycloak_username)
        except Exception:
            pass

    try:
        tokens = password_login(body.email, body.password, route, settings)
    except LoginFailedError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    return LoginResponse(
        accessToken=tokens["accessToken"],
        idToken=tokens.get("idToken"),
        realm=tokens["realm"],
        kind=route.kind,
    )


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(
    body: ForgotPasswordRequest,
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
) -> None:
    """Send a password-reset email when the account exists (always 204)."""
    if settings.auth_disabled:
        return
    if not admin_store_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset is not configured on this cluster",
        )
    try:
        route = resolve_login_route(
            body.email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError:
        return
    realm = settings.kernel_realm if route.idp_hint is None else route.idp_hint
    try:
        await store.send_password_reset_by_email(realm, body.email)
    except Exception:
        return


@router.post("/idp-session", response_model=IdpSessionResponse)
def idp_session(
    response: Response,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> IdpSessionResponse:
    """Bootstrap a Keycloak browser SSO session after portal password login."""
    if settings.auth_disabled:
        return IdpSessionResponse(skipped=True)

    res = create_idp_session_redirect(user, settings)
    if res is None:
        return IdpSessionResponse(skipped=True)
    redirect_url, cookies_to_set = res
    for c in cookies_to_set:
        response.set_cookie(
            key=c["key"],
            value=c["value"],
            domain=f".{settings.kernel_domain}",
            path=c["path"],
            httponly=c["httponly"],
            samesite="none",
            secure=True,
        )
    return IdpSessionResponse(redirectUrl=redirect_url)
