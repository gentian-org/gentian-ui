"""Mint short-lived Nextcloud local-login sessions for portal-embedded Files."""

from __future__ import annotations

import base64
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from xml.etree import ElementTree

import httpx
import jwt
from fastapi import HTTPException, status
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from app.core.config import Settings

_TICKET_TTL_SECONDS = 60
_CLOUD_ORIGIN_RE = re.compile(r"^https://cloud\.[a-z0-9-]+\.[a-z0-9.-]+$")
_OCS_NS = {"ocs": "http://owncloud.org/ns"}


def nextcloud_uid_from_claims(claims: dict[str, Any]) -> str:
    for key in ("opendesk_username", "preferred_username", "email"):
        raw = str(claims.get(key) or "").strip()
        if not raw:
            continue
        if "@" in raw:
            return raw.split("@", 1)[0]
        return raw
    return ""


def nextcloud_origin(tenant: str, kernel_domain: str) -> str:
    return f"https://cloud.{tenant}.{kernel_domain.strip().lower()}"


def is_allowed_cloud_origin(origin: str, settings: Settings) -> bool:
    origin = origin.strip().rstrip("/")
    if not origin:
        return False
    if not _CLOUD_ORIGIN_RE.match(origin):
        return False
    return origin.endswith(f".{settings.kernel_domain.strip().lower()}")


def _ticket_secret(settings: Settings) -> str:
    secret = settings.portal_bff_client_secret or settings.oidc_client_secret
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nextcloud bridge is not configured on this cluster",
        )
    return secret


def _core_v1_api() -> client.CoreV1Api:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()


def _read_nextcloud_admin_credentials(tenant: str) -> tuple[str, str]:
    namespace = f"tenant-{tenant}"
    try:
        secret = _core_v1_api().read_namespaced_secret("nextcloud-sensitive-values", namespace)
    except ApiException as exc:
        if exc.status == 404:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Nextcloud admin credentials are not available for this tenant",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not read Nextcloud credentials",
        ) from exc

    data = secret.data or {}
    encoded = data.get("internal-admin_password")
    if not encoded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nextcloud admin credentials are incomplete for this tenant",
        )
    return "admin", base64.b64decode(encoded).decode("utf-8")


def _ocs_meta(root: ElementTree.Element) -> ElementTree.Element | None:
    meta = root.find("ocs:meta", _OCS_NS)
    if meta is not None:
        return meta
    return root.find("meta")


def _ocs_status(root: ElementTree.Element) -> tuple[str, str]:
    meta = _ocs_meta(root)
    if meta is None:
        return "failure", "Invalid OCS response"

    def _meta_text(tag: str) -> str:
        namespaced = meta.findtext(f"ocs:{tag}", default="", namespaces=_OCS_NS)
        if namespaced:
            return namespaced.strip()
        return (meta.findtext(tag, default="") or "").strip()

    status_code = _meta_text("statuscode")
    message = _meta_text("message")
    status_text = _meta_text("status")
    return status_text, status_code or message


def _ensure_nextcloud_user(
    *,
    cloud_url: str,
    admin_user: str,
    admin_password: str,
    uid: str,
    display_name: str | None,
    password: str,
) -> None:
    auth = (admin_user, admin_password)
    headers = {"OCS-APIRequest": "true"}
    base = cloud_url.rstrip("/")

    create = httpx.post(
        f"{base}/ocs/v1.php/cloud/users",
        auth=auth,
        headers=headers,
        data={
            "userid": uid,
            "password": password,
            "displayName": display_name or uid,
        },
        timeout=20.0,
    )
    if create.status_code < 400:
        root = ElementTree.fromstring(create.text)
        status_text, detail = _ocs_status(root)
        if status_text == "ok" and detail == "100":
            return

    update = httpx.put(
        f"{base}/ocs/v1.php/cloud/users/{uid}",
        auth=auth,
        headers=headers,
        data={"key": "password", "value": password},
        timeout=20.0,
    )
    if update.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not prepare Nextcloud account",
        )
    root = ElementTree.fromstring(update.text)
    status_text, detail = _ocs_status(root)
    if status_text != "ok":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not prepare Nextcloud account ({detail})",
        )


def create_nextcloud_bridge_session(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> dict[str, str]:
    uid = nextcloud_uid_from_claims(claims)
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve Nextcloud username",
        )

    admin_user, admin_password = _read_nextcloud_admin_credentials(tenant)
    cloud_url = nextcloud_origin(tenant, settings.kernel_domain)
    portal_password = secrets.token_urlsafe(24)
    display_name = str(claims.get("name") or "").strip() or None

    _ensure_nextcloud_user(
        cloud_url=cloud_url,
        admin_user=admin_user,
        admin_password=admin_password,
        uid=uid,
        display_name=display_name,
        password=portal_password,
    )

    return {"username": uid, "password": portal_password}


def create_nextcloud_bridge_ticket(
    claims: dict[str, Any],
    *,
    tenant: str,
    settings: Settings,
) -> str:
    session = create_nextcloud_bridge_session(claims, tenant=tenant, settings=settings)
    now = datetime.now(UTC)
    payload = {
        "exp": now + timedelta(seconds=_TICKET_TTL_SECONDS),
        "iat": now,
        "u": session["username"],
        "p": session["password"],
    }
    return jwt.encode(payload, _ticket_secret(settings), algorithm="HS256")


def redeem_nextcloud_bridge_ticket(ticket: str, settings: Settings) -> dict[str, str]:
    try:
        payload = jwt.decode(
            ticket,
            _ticket_secret(settings),
            algorithms=["HS256"],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Nextcloud bridge ticket",
        ) from exc

    username = payload.get("u")
    password = payload.get("p")
    if not isinstance(username, str) or not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Nextcloud bridge ticket",
        )
    if not isinstance(password, str) or not password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Nextcloud bridge ticket",
        )
    return {"username": username, "password": password}
