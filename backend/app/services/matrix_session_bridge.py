"""Mint short-lived Matrix sessions for portal-embedded Element."""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status

from app.core.config import Settings

_BRIDGE_USER = "gentian-portal-bridge"
_TICKET_TTL_SECONDS = 60
_APP_ORIGIN_RE = re.compile(r"^https://(chat|matrix)\.[a-z0-9-]+\.[a-z0-9.-]+$")


def matrix_localpart_from_claims(claims: dict[str, Any]) -> str:
    username = str(claims.get("preferred_username") or claims.get("email") or "").strip()
    if "@" in username:
        return username.split("@", 1)[0]
    return username


def matrix_server_name(tenant: str, kernel_domain: str) -> str:
    return f"{tenant}.{kernel_domain.strip().lower()}"


def matrix_homeserver_url(tenant: str, kernel_domain: str) -> str:
    return f"https://matrix.{tenant}.{kernel_domain.strip().lower()}"


def matrix_user_id(localpart: str, tenant: str, kernel_domain: str) -> str:
    return f"@{localpart}:{matrix_server_name(tenant, kernel_domain)}"


def bridge_user_id(tenant: str, kernel_domain: str) -> str:
    return matrix_user_id(_BRIDGE_USER, tenant, kernel_domain)


def is_allowed_app_origin(origin: str, settings: Settings) -> bool:
    origin = origin.strip().rstrip("/")
    if not origin:
        return False
    if not _APP_ORIGIN_RE.match(origin):
        return False
    kernel_domain = settings.kernel_domain.strip().lower()
    return origin.endswith(f".{kernel_domain}")


def _ticket_secret(settings: Settings) -> str:
    secret = settings.portal_bff_client_secret or settings.oidc_client_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Matrix bridge is not configured on this cluster",
        )
    return secret


def _bridge_password(settings: Settings) -> str:
    return settings.matrix_bridge_password or "portal-bridge-not-used-for-login"


def _matrix_request(
    method: str,
    url: str,
    *,
    json_body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    detail: str,
    verify: bool = True,
) -> dict[str, Any]:
    try:
        response = httpx.request(
            method,
            url,
            json=json_body,
            headers=headers,
            timeout=15.0,
            verify=verify,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the Matrix homeserver",
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        )

    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        )
    return payload


def _login_with_password(
    matrix_url: str,
    user_id: str,
    password: str,
    verify: bool = True,
) -> dict[str, str]:
    payload = _matrix_request(
        "POST",
        f"{matrix_url.rstrip('/')}/_matrix/client/v3/login",
        json_body={
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": user_id},
            "password": password,
        },
        detail="Matrix bridge authentication failed",
        verify=verify,
    )
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Matrix bridge authentication failed",
        )
    result = {
        "accessToken": access_token,
        "userId": str(payload.get("user_id") or user_id),
    }
    device_id = payload.get("device_id")
    if isinstance(device_id, str) and device_id:
        result["deviceId"] = device_id
    return result


def _ensure_matrix_user(
    matrix_url: str,
    admin_token: str,
    user_id: str,
    *,
    display_name: str | None,
    password: str,
    verify: bool = True,
) -> None:
    body: dict[str, Any] = {"password": password, "admin": False}
    if display_name:
        body["displayname"] = display_name
    _matrix_request(
        "PUT",
        f"{matrix_url.rstrip('/')}/_synapse/admin/v2/users/{user_id}",
        json_body=body,
        headers={"Authorization": f"Bearer {admin_token}"},
        detail="Could not prepare Matrix account",
        verify=verify,
    )


def create_matrix_session(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> dict[str, str]:
    localpart = matrix_localpart_from_claims(claims)
    if not localpart:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve Matrix username",
        )

    matrix_url = matrix_homeserver_url(tenant, settings.kernel_domain)
    user_id = matrix_user_id(localpart, tenant, settings.kernel_domain)
    bridge_id = bridge_user_id(tenant, settings.kernel_domain)
    bridge_password = _bridge_password(settings)
    portal_password = secrets.token_urlsafe(24)
    verify = settings.is_production

    admin_token = _login_with_password(
        matrix_url,
        bridge_id,
        bridge_password,
        verify=verify,
    )["accessToken"]
    display_name = str(claims.get("name") or "").strip() or None
    _ensure_matrix_user(
        matrix_url,
        admin_token,
        user_id,
        display_name=display_name,
        password=portal_password,
        verify=verify,
    )
    login = _login_with_password(matrix_url, user_id, portal_password, verify=verify)

    session = {
        "homeServerUrl": matrix_url,
        "userId": login["userId"],
        "accessToken": login["accessToken"],
    }
    if device_id := login.get("deviceId"):
        session["deviceId"] = device_id
    return session


def create_matrix_bridge_ticket(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> str:
    session = create_matrix_session(claims, tenant=tenant, settings=settings)
    now = datetime.now(UTC)
    payload = {
        "exp": now + timedelta(seconds=_TICKET_TTL_SECONDS),
        "iat": now,
        "hs": session["homeServerUrl"],
        "uid": session["userId"],
        "at": session["accessToken"],
    }
    if device_id := session.get("deviceId"):
        payload["did"] = device_id
    return jwt.encode(payload, _ticket_secret(settings), algorithm="HS256")


def redeem_matrix_bridge_ticket(ticket: str, settings: Settings) -> dict[str, str]:
    try:
        payload = jwt.decode(
            ticket,
            _ticket_secret(settings),
            algorithms=["HS256"],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Matrix bridge ticket",
        ) from exc

    home_server = payload.get("hs")
    user_id = payload.get("uid")
    access_token = payload.get("at")
    if not all(isinstance(value, str) and value for value in (home_server, user_id, access_token)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Matrix bridge ticket",
        )

    session = {
        "homeServerUrl": home_server,
        "userId": user_id,
        "accessToken": access_token,
    }
    device_id = payload.get("did")
    if isinstance(device_id, str) and device_id:
        session["deviceId"] = device_id
    return session
