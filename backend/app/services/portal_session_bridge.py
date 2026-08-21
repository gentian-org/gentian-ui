"""Mint short-lived generic login sessions for portal-embedded apps."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException, status

from app.core.config import Settings

_TICKET_TTL_SECONDS = 60


def portal_username_from_claims(claims: dict[str, Any]) -> str:
    for key in ("preferred_username", "email"):
        raw = str(claims.get(key) or "").strip()
        if not raw:
            continue
        if "@" in raw:
            return raw.split("@", 1)[0]
        return raw
    return ""


def is_allowed_tenant_origin(origin: str, settings: Settings) -> bool:
    origin = origin.strip().rstrip("/")
    if not origin:
        return False
    if not origin.startswith("https://"):
        return False

    host = origin[8:]
    kernel_domain = settings.kernel_domain.strip().lower()
    if not host.endswith(f".{kernel_domain}"):
        return False

    # Check that there is a subdomain and a tenant name (i.e. at least two dots before kernel_domain)
    # e.g., cloud.demo.desk.gentian.org -> prefix is 'cloud.demo'
    prefix = host[: -len(kernel_domain) - 1]
    parts = prefix.split(".")
    if len(parts) < 2:
        return False
    return True


def _ticket_secret(settings: Settings) -> str:
    secret = settings.portal_bff_client_secret or settings.oidc_client_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Portal bridge is not configured on this cluster",
        )
    return secret


def create_portal_bridge_ticket(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> str:
    uid = portal_username_from_claims(claims)
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve username from claims",
        )

    now = datetime.now(UTC)
    payload = {
        "exp": now + timedelta(seconds=_TICKET_TTL_SECONDS),
        "iat": now,
        "u": uid,
        "e": claims.get("email"),
        "n": claims.get("name"),
        "t": tenant,
        "g": claims.get("groups") or [],
    }
    return jwt.encode(payload, _ticket_secret(settings), algorithm="HS256")


def redeem_portal_bridge_ticket(ticket: str, settings: Settings) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            ticket,
            _ticket_secret(settings),
            algorithms=["HS256"],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired bridge ticket",
        ) from exc

    username = payload.get("u")
    if not isinstance(username, str) or not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bridge ticket",
        )

    return {
        "username": username,
        "email": payload.get("e"),
        "name": payload.get("n"),
        "tenant": payload.get("t"),
        "groups": payload.get("g") or [],
    }
