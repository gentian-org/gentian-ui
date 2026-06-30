"""Password login via Keycloak direct access grant (BFF-only, no browser redirect)."""

from __future__ import annotations

import httpx

from app.core.config import Settings
from app.core.login_routing import LoginRoute


class LoginFailedError(Exception):
    """Raised when Keycloak rejects username/password."""


def _keycloak_base(settings: Settings) -> str:
    base = settings.keycloak_admin_url or settings.oidc_issuer or ""
    base = base.rstrip("/")
    if base.endswith("/auth"):
        return base
    if "/realms/" in base:
        return base[: base.index("/realms/")]
    return base


def realm_issuer(settings: Settings, realm: str) -> str:
    base = _keycloak_base(settings)
    if base.endswith("/auth"):
        return f"{base}/realms/{realm}"
    return f"{base}/auth/realms/{realm}"


def password_login(
    email: str,
    password: str,
    route: LoginRoute,
    settings: Settings,
) -> dict[str, str]:
    if not settings.portal_bff_client_id or not settings.portal_bff_client_secret:
        raise LoginFailedError("Portal password login is not configured on this cluster")

    realm = settings.kernel_realm if route.idp_hint is None else route.idp_hint
    token_url = f"{realm_issuer(settings, realm)}/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": settings.portal_bff_client_id,
        "client_secret": settings.portal_bff_client_secret,
        "username": route.keycloak_username,
        "password": password,
        "scope": "openid profile email",
    }
    try:
        response = httpx.post(token_url, data=data, timeout=15.0)
    except httpx.HTTPError as exc:
        raise LoginFailedError("Could not reach the identity service") from exc

    if response.status_code in {400, 401}:
        raise LoginFailedError("Invalid username or password")
    if response.status_code >= 400:
        raise LoginFailedError("Sign-in failed. Please try again.")

    payload = response.json()
    access_token = payload.get("access_token")
    if not access_token:
        raise LoginFailedError("Sign-in failed. Please try again.")

    result: dict[str, str] = {"accessToken": access_token, "realm": realm}
    if id_token := payload.get("id_token"):
        result["idToken"] = id_token
    if refresh_token := payload.get("refresh_token"):
        result["refreshToken"] = refresh_token
    return result
