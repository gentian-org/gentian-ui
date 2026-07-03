"""Mint short-lived OpenProject sessions for portal-embedded Projects."""

from __future__ import annotations

import base64
import json
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from app.core.config import Settings

_TICKET_TTL_SECONDS = 60
_PROJECTS_ORIGIN_RE = re.compile(r"^https://projects\.[a-z0-9-]+\.[a-z0-9.-]+$")


def openproject_login_from_claims(claims: dict[str, Any]) -> str:
    for key in ("gentian_username", "opendesk_username", "preferred_username", "email"):
        raw = str(claims.get(key) or "").strip()
        if not raw:
            continue
        if "@" in raw:
            return raw.split("@", 1)[0]
        return raw
    return ""


def openproject_origin(tenant: str, kernel_domain: str) -> str:
    return f"https://projects.{tenant}.{kernel_domain.strip().lower()}"


def is_allowed_projects_origin(origin: str, settings: Settings) -> bool:
    origin = origin.strip().rstrip("/")
    if not origin:
        return False
    if not _PROJECTS_ORIGIN_RE.match(origin):
        return False
    return origin.endswith(f".{settings.kernel_domain.strip().lower()}")


def _ticket_secret(settings: Settings) -> str:
    secret = settings.portal_bff_client_secret or settings.oidc_client_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenProject bridge is not configured on this cluster",
        )
    return secret


def _core_v1_api() -> client.CoreV1Api:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()


def _read_openproject_api_admin_credentials(tenant: str) -> tuple[str, str]:
    namespace = f"tenant-{tenant}"
    try:
        secret = _core_v1_api().read_namespaced_secret("openproject-sensitive-values", namespace)
    except ApiException as exc:
        if exc.status == 404:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OpenProject API credentials are not available for this tenant",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not read OpenProject credentials",
        ) from exc

    data = secret.data or {}
    encoded = data.get("internal-api_admin_password")
    if not encoded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenProject API credentials are incomplete for this tenant",
        )
    return "api_admin", base64.b64decode(encoded).decode("utf-8")


def _openproject_user_filters(login: str) -> str:
    return json.dumps([{"login": {"operator": "=", "values": [login]}}])


def _ensure_openproject_user(
    *,
    projects_url: str,
    admin_user: str,
    admin_password: str,
    login: str,
    display_name: str | None,
    email: str | None,
    password: str,
) -> None:
    auth = (admin_user, admin_password)
    base = projects_url.rstrip("/")
    first_name, last_name = _split_display_name(display_name or login, login)
    payload = {
        "login": login,
        "email": email or f"{login}@projects.local",
        "firstName": first_name,
        "lastName": last_name,
        "password": password,
    }

    create = httpx.post(
        f"{base}/api/v3/users",
        auth=auth,
        json=payload,
        timeout=20.0,
    )
    if create.status_code in {200, 201}:
        return

    search = httpx.get(
        f"{base}/api/v3/users",
        auth=auth,
        params={"filters": _openproject_user_filters(login)},
        timeout=20.0,
    )
    if search.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not prepare OpenProject account",
        )

    body = search.json()
    elements = body.get("_embedded", {}).get("elements", [])
    if not elements:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not prepare OpenProject account",
        )

    user_id = elements[0].get("id")
    if not isinstance(user_id, int):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not prepare OpenProject account",
        )

    update = httpx.patch(
        f"{base}/api/v3/users/{user_id}",
        auth=auth,
        json={"password": password},
        timeout=20.0,
    )
    if update.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not prepare OpenProject account",
        )


def _split_display_name(display_name: str, login: str) -> tuple[str, str]:
    parts = display_name.strip().split(None, 1)
    if not parts:
        return login, login
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], parts[1]


def create_openproject_bridge_session(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> dict[str, str]:
    login = openproject_login_from_claims(claims)
    if not login:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve OpenProject username",
        )

    admin_user, admin_password = _read_openproject_api_admin_credentials(tenant)
    projects_url = openproject_origin(tenant, settings.kernel_domain)
    portal_password = secrets.token_urlsafe(24)
    display_name = str(claims.get("name") or "").strip() or None
    email = str(claims.get("email") or "").strip() or None

    _ensure_openproject_user(
        projects_url=projects_url,
        admin_user=admin_user,
        admin_password=admin_password,
        login=login,
        display_name=display_name,
        email=email,
        password=portal_password,
    )

    return {"username": login, "password": portal_password}


def create_openproject_bridge_ticket(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> str:
    session = create_openproject_bridge_session(claims, tenant=tenant, settings=settings)
    now = datetime.now(UTC)
    payload = {
        "exp": now + timedelta(seconds=_TICKET_TTL_SECONDS),
        "iat": now,
        "u": session["username"],
        "p": session["password"],
    }
    return jwt.encode(payload, _ticket_secret(settings), algorithm="HS256")


def redeem_openproject_bridge_ticket(ticket: str, settings: Settings) -> dict[str, str]:
    try:
        payload = jwt.decode(
            ticket,
            _ticket_secret(settings),
            algorithms=["HS256"],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OpenProject bridge ticket",
        ) from exc

    username = payload.get("u")
    password = payload.get("p")
    if not isinstance(username, str) or not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OpenProject bridge ticket",
        )
    if not isinstance(password, str) or not password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OpenProject bridge ticket",
        )
    return {"username": username, "password": password}
