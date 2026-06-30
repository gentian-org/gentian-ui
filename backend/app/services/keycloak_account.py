"""Self-service account operations via Keycloak Account REST API (user bearer token)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.services.keycloak_password_login import realm_issuer
from app.services.keycloak_user_groups import realm_from_issuer


class AccountServiceError(Exception):
    """Raised when Keycloak rejects an account operation."""


def _account_base(settings: Settings, realm: str) -> str:
    return f"{realm_issuer(settings, realm)}/account"


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
    url = _account_base(settings, realm)
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))
    data = response.json()
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
    url = _account_base(settings, realm)
    body = {
        "email": claims.get("email"),
        "username": claims.get("preferred_username"),
        "firstName": first_name or "",
        "lastName": last_name or "",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body,
        )
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))
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
    url = f"{_account_base(settings, realm)}/password"
    body = {
        "currentPassword": current_password,
        "newPassword": new_password,
        "confirmation": new_password,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body,
        )
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))


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
    url = f"{_account_base(settings, realm)}/sessions/devices"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))

    sessions: list[dict[str, Any]] = []
    for device in response.json():
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
    url = f"{_account_base(settings, realm)}/sessions/{quote(session_id, safe='')}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.delete(url, headers={"Authorization": f"Bearer {token}"})
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))


async def revoke_all_sessions(
    *,
    token: str,
    claims: dict[str, Any],
    settings: Settings,
) -> None:
    if settings.auth_disabled:
        return

    realm = realm_for_user(claims, settings)
    url = f"{_account_base(settings, realm)}/sessions"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.delete(url, headers={"Authorization": f"Bearer {token}"})
    if response.status_code >= 400:
        raise AccountServiceError(_detail_from_response(response))


async def _totp_status(
    token: str,
    realm: str,
    settings: Settings,
    account_data: dict[str, Any],
) -> tuple[bool, bool]:
    url = f"{_account_base(settings, realm)}/credentials"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    if response.status_code >= 400:
        required = account_data.get("requiredActions") or []
        return False, "CONFIGURE_TOTP" in required

    configured = any(item.get("type") == "otp" for item in response.json())
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
