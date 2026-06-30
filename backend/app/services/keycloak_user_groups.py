"""Resolve Keycloak group membership when JWT/userinfo omit groups claims."""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import Settings

_admin_token = ""
_admin_token_expiry = 0.0


def realm_from_issuer(issuer: str) -> str | None:
    normalized = issuer.rstrip("/")
    marker = "/realms/"
    if marker not in normalized:
        return None
    realm = normalized.split(marker, 1)[1]
    return realm or None


def _fetch_admin_token(settings: Settings) -> str:
    global _admin_token, _admin_token_expiry

    if _admin_token and time.time() < _admin_token_expiry:
        return _admin_token

    if not settings.keycloak_admin_url or not settings.keycloak_admin_password:
        return ""

    base = settings.keycloak_admin_url.rstrip("/")
    response = httpx.post(
        f"{base}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": settings.keycloak_admin_username,
            "password": settings.keycloak_admin_password,
        },
        timeout=15.0,
    )
    response.raise_for_status()
    payload = response.json()
    token = str(payload.get("access_token") or "")
    expires_in = float(payload.get("expires_in") or 60)
    _admin_token = token
    _admin_token_expiry = time.time() + max(expires_in - 30, 30)
    return token


def lookup_user_groups(claims: dict[str, Any], settings: Settings) -> list[str]:
    if not settings.keycloak_admin_url:
        return []
    issuer = str(claims.get("iss") or "")
    realm = realm_from_issuer(issuer)
    user_id = str(claims.get("sub") or "")
    if not realm or realm == "master" or not user_id:
        return []

    token = _fetch_admin_token(settings)
    if not token:
        return []

    base = settings.keycloak_admin_url.rstrip("/")
    try:
        response = httpx.get(
            f"{base}/admin/realms/{quote(realm, safe='')}/users/{quote(user_id, safe='')}/groups",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15.0,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return []

    groups: list[str] = []
    for item in response.json():
        name = item.get("name")
        if name:
            groups.append(str(name))
    return groups
