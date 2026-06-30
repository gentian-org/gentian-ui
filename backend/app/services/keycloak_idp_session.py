"""Establish a Keycloak browser SSO session for portal BFF (password) logins."""

from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.services.keycloak_user_groups import _fetch_admin_token

_REALM_RE = re.compile(r"/realms/([^/]+)/?$")


def realm_from_issuer(issuer: str) -> str | None:
    match = _REALM_RE.search(issuer.rstrip("/"))
    return match.group(1) if match else None


def create_idp_session_redirect(claims: dict[str, Any], settings: Settings) -> str | None:
    """Return a browser URL that sets the user's Keycloak SSO cookie in their realm.

    Portal password login uses the direct access grant and does not create browser
    cookies. Embedded OIDC apps (Element, XWiki, …) need that cookie for silent SSO.
    """
    if claims.get("azp") != settings.portal_bff_client_id:
        return None

    user_id = str(claims.get("sub") or "").strip()
    issuer = str(claims.get("iss") or "").strip()
    realm = realm_from_issuer(issuer)
    if not user_id or not realm:
        return None
    if not settings.keycloak_admin_url or not settings.keycloak_admin_password:
        return None

    try:
        admin_token = _fetch_admin_token(settings)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the identity service",
        ) from exc

    if not admin_token:
        return None

    base = settings.keycloak_admin_url.rstrip("/")
    url = f"{base}/admin/realms/{realm}/users/{user_id}/impersonation"
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        response = httpx.post(url, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the identity service",
        ) from exc

    if response.status_code == 403:
        return None
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not establish identity session",
        )

    payload = response.json()
    redirect = payload.get("redirect")
    if not isinstance(redirect, str) or not redirect.strip():
        return None
    return redirect.strip()
