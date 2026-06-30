"""Password login via Keycloak direct access grant (BFF-only, no browser redirect)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import Settings
from app.core.login_routing import LoginRoute, resolve_login_route


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


def resolve_password_login_route(email: str, settings: Settings) -> LoginRoute:
    """Resolve email to a Keycloak realm for password login."""
    try:
        return resolve_login_route(
            email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError:
        located = _locate_user_in_keycloak(email, settings)
        if located is None:
            raise ValueError("No Gentian workspace found for this email address") from None
        realm, username = located
        normalized = email.strip().lower()
        if realm == settings.kernel_realm:
            return LoginRoute(
                login_hint=normalized,
                keycloak_username=username,
                idp_hint=None,
                kind="platform",
            )
        return LoginRoute(
            login_hint=normalized,
            keycloak_username=username,
            idp_hint=realm,
            kind="tenant",
        )


def _keycloak_admin_headers(settings: Settings) -> dict[str, str]:
    if not settings.keycloak_admin_url or not settings.keycloak_admin_password:
        raise ValueError("No Gentian workspace found for this email address")
    base = settings.keycloak_admin_url.rstrip("/")
    token_url = f"{base}/realms/master/protocol/openid-connect/token"
    response = httpx.post(
        token_url,
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": settings.keycloak_admin_username,
            "password": settings.keycloak_admin_password,
        },
        timeout=15.0,
    )
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise ValueError("No Gentian workspace found for this email address")
    return {"Authorization": f"Bearer {token}"}


def _locate_user_in_keycloak(email: str, settings: Settings) -> tuple[str, str] | None:
    """Find a realm/username for members whose login email is outside *.kernel_domain."""
    normalized = email.strip().lower()
    if not normalized:
        return None
    headers = _keycloak_admin_headers(settings)
    base = settings.keycloak_admin_url.rstrip("/")
    realms = httpx.get(f"{base}/admin/realms", headers=headers, timeout=15.0)
    realms.raise_for_status()
    for realm in realms.json():
        realm_name = realm.get("realm")
        if not realm_name or realm_name == "master":
            continue
        for params in (
            {"email": normalized, "exact": "true"},
            {"username": normalized, "exact": "true"},
        ):
            users = httpx.get(
                f"{base}/admin/realms/{quote(realm_name, safe='')}/users",
                headers=headers,
                params=params,
                timeout=15.0,
            )
            users.raise_for_status()
            matches: list[dict[str, Any]] = users.json()
            if matches:
                username = str(matches[0].get("username") or normalized)
                return realm_name, username
    return None


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
