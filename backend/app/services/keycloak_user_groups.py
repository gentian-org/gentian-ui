"""Resolve Keycloak group membership when JWT/userinfo omit groups claims."""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import Settings


def realm_from_issuer(issuer: str) -> str | None:
    normalized = issuer.rstrip("/")
    marker = "/realms/"
    if marker not in normalized:
        return None
    realm = normalized.split(marker, 1)[1]
    return realm or None


@lru_cache
def _admin_token(settings: Settings) -> tuple[str, float]:
    if not settings.keycloak_admin_url or not settings.keycloak_admin_password:
        return "", 0.0
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
    import time

    return token, time.time() + max(expires_in - 30, 30)


def _admin_headers(settings: Settings) -> dict[str, str] | None:
    token, expiry = _admin_token(settings)
    if not token:
        return None
    import time

    if time.time() >= expiry:
        _admin_token.cache_clear()
        token, _ = _admin_token(settings)
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


def lookup_user_groups(claims: dict[str, Any], settings: Settings) -> list[str]:
    if not settings.keycloak_admin_url:
        return []
    issuer = str(claims.get("iss") or "")
    realm = realm_from_issuer(issuer)
    user_id = str(claims.get("sub") or "")
    if not realm or realm == "master" or not user_id:
        return []

    headers = _admin_headers(settings)
    if headers is None:
        return []

    base = settings.keycloak_admin_url.rstrip("/")
    try:
        response = httpx.get(
            f"{base}/admin/realms/{quote(realm, safe='')}/users/{quote(user_id, safe='')}/groups",
            headers=headers,
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
