"""Unauthenticated auth helpers for the portal login page."""

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import Settings, get_settings
from app.core.login_routing import resolve_login_route
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
def login(body: LoginRequest, settings: Settings = Depends(get_settings)) -> LoginResponse:
    """Authenticate with email/password on the Gentian login page (no Keycloak redirect)."""
    try:
        route = resolve_login_route(
            body.email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
        tokens = password_login(body.email, body.password, route, settings)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LoginFailedError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    return LoginResponse(
        accessToken=tokens["accessToken"],
        idToken=tokens.get("idToken"),
        realm=tokens["realm"],
        kind=route.kind,
    )
