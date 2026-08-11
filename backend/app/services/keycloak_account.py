"""Self-service account operations via Keycloak Account REST API (user bearer token)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.services.keycloak_user_groups import realm_from_issuer


class AccountServiceError(Exception):
    """Raised when Keycloak rejects an account operation."""


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


def _account_base(settings: Settings, realm: str) -> str:
    return f"{realm_issuer(settings, realm)}/account"


def _account_url(settings: Settings, realm: str, suffix: str = "") -> str:
    base = _account_base(settings, realm).rstrip("/") + "/"
    if not suffix:
        return base
    return base + suffix.lstrip("/")


def _account_headers(*, token: str, json_body: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _ensure_account_success(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))
    if response.status_code == 204 or not response.content:
        return
    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" not in content_type:
        raise AccountServiceError(
            "Account API returned an unexpected response. Try signing in again."
        )


def _read_account_json(response: httpx.Response) -> Any:
    _ensure_account_success(response)
    try:
        return response.json()
    except ValueError as exc:
        raise AccountServiceError("Account API returned invalid JSON.") from exc


def realm_for_user(claims: dict[str, Any], settings: Settings) -> str:
    issuer = str(claims.get("iss") or "")
    realm = realm_from_issuer(issuer)
    if realm:
        return realm
    tenant = str(claims.get("tenant") or settings.kernel_realm)
    if tenant == settings.kernel_domain:
        return settings.kernel_realm
    return tenant


async def get_profile(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
) -> dict[str, Any]:
    if settings.auth_disabled:
        return {
            "email": claims.get("email") or "dev@gentian.local",
            "firstName": "Dev",
            "lastName": "User",
            "username": claims.get("preferred_username") or "dev-user",
            "totpConfigured": False,
            "totpPending": False,
        }

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm)
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=_account_headers(token=token))
    data = _read_account_json(response)
    totp_configured, totp_pending = await _totp_status(token, realm, settings, data)
    return {
        "email": data.get("email") or claims.get("email"),
        "firstName": data.get("firstName") or "",
        "lastName": data.get("lastName") or "",
        "username": data.get("username") or claims.get("preferred_username"),
        "totpConfigured": totp_configured,
        "totpPending": totp_pending,
    }


async def update_profile(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
    first_name: str | None,
    last_name: str | None,
) -> dict[str, Any]:
    if settings.auth_disabled:
        return await get_profile(token=token, claims=claims, settings=settings)

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm)
    body = {
        "email": claims.get("email"),
        "username": claims.get("preferred_username"),
        "firstName": first_name or "",
        "lastName": last_name or "",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            headers=_account_headers(token=token, json_body=True),
            json=body,
        )
    _ensure_account_success(response)
    return await get_profile(token=token, claims=claims, settings=settings)


async def change_password(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
    current_password: str,
    new_password: str,
) -> None:
    if settings.auth_disabled:
        if current_password == "wrong":
            raise AccountServiceError("Current password is incorrect")
        return

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm, "password")
    body = {
        "currentPassword": current_password,
        "newPassword": new_password,
        "confirmation": new_password,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            headers=_account_headers(token=token, json_body=True),
            json=body,
        )
    _ensure_account_success(response)


async def list_sessions(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
) -> list[dict[str, Any]]:
    if settings.auth_disabled:
        return [
            {
                "id": "dev-session",
                "ipAddress": "127.0.0.1",
                "started": 0,
                "lastAccess": 0,
                "current": True,
                "clients": [{"clientName": "Gentian Portal", "userSessionId": "dev-session"}],
            }
        ]

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm, "sessions/devices")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=_account_headers(token=token))
    devices = _read_account_json(response)

    sessions: list[dict[str, Any]] = []
    for device in devices:
        for session in device.get("sessions") or []:
            sessions.append(
                {
                    "id": session.get("id"),
                    "ipAddress": device.get("ipAddress"),
                    "started": session.get("started"),
                    "lastAccess": session.get("lastAccess"),
                    "current": bool(session.get("current")),
                    "clients": session.get("clients") or [],
                }
            )
    return sessions


async def revoke_session(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
    session_id: str,
) -> None:
    if settings.auth_disabled:
        return

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm, f"sessions/{quote(session_id, safe='')}")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.delete(url, headers=_account_headers(token=token))
    _ensure_account_success(response)


async def revoke_all_sessions(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
) -> None:
    if settings.auth_disabled:
        return

    realm = realm_for_user(claims, settings)
    url = _account_url(settings, realm, "sessions")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.delete(url, headers=_account_headers(token=token))
    _ensure_account_success(response)


def _totp_is_configured(credentials: Any) -> bool:
    """Return True when the user has a configured OTP credential.

    Keycloak's account API returns CredentialContainer objects (one per enabled
    credential type). A container with ``type: otp`` is present even when the user
    has not enrolled TOTP yet; configured credentials live in
    ``userCredentialMetadatas`` / ``userCredentials``.
    """
    if not isinstance(credentials, list):
        return False
    for item in credentials:
        if not isinstance(item, dict) or item.get("type") != "otp":
            continue
        user_creds = item.get("userCredentialMetadatas") or item.get("userCredentials")
        if user_creds is not None:
            if len(user_creds) > 0:
                return True
            continue
        # Admin API shape: flat CredentialRepresentation entries.
        if item.get("id"):
            return True
    return False


async def _totp_status(
    token: str,
    realm: str,
    settings: Settings,
    account_data: dict[str, Any],
) -> tuple[bool, bool]:
    url = _account_url(settings, realm, "credentials")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=_account_headers(token=token))
    if response.status_code >= 400:
        required = account_data.get("requiredActions") or []
        return False, "CONFIGURE_TOTP" in required

    credentials = _read_account_json(response)
    configured = _totp_is_configured(credentials)
    required = account_data.get("requiredActions") or []
    pending = "CONFIGURE_TOTP" in required and not configured
    return configured, pending


def _detail_from_response(response: httpx.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            if payload.get("error_description"):
                return str(payload["error_description"])
            if payload.get("errorMessage"):
                return str(payload["errorMessage"])
            if payload.get("error"):
                return str(payload["error"])
    except Exception:
        pass
    if response.status_code == 401:
        return "Session expired. Sign in again."
    return "Account operation failed. Please try again."


def account_error_to_http(exc: AccountServiceError) -> HTTPException:
    message = str(exc)
    status_code = status.HTTP_400_BAD_REQUEST
    if "expired" in message.lower() or "not authenticated" in message.lower():
        status_code = status.HTTP_401_UNAUTHORIZED
    if "incorrect" in message.lower() or "invalid" in message.lower():
        status_code = status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=status_code, detail=message)
