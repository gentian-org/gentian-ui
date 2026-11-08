"""Resolve per-tenant portal shell database URLs from Kubernetes Secrets."""

from __future__ import annotations

import base64
from functools import lru_cache
from urllib.parse import quote

from kubernetes import client, config
from kubernetes.client.rest import ApiException

from app.core.config import Settings, get_settings

PORTAL_SHELL_SECRET_PREFIX = "portal-shell-"


@lru_cache
def _core_v1_api() -> client.CoreV1Api:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()


def portal_shell_secret_name(tenant: str) -> str:
    return f"{PORTAL_SHELL_SECRET_PREFIX}{tenant}"


def resolve_tenant_database_url(tenant: str, settings: Settings | None = None) -> str:
    _settings = settings or get_settings()
    if _settings.database_url:
        return _settings.database_url

    secret_name = portal_shell_secret_name(tenant)
    try:
        secret = _core_v1_api().read_namespaced_secret(secret_name, _settings.portal_shell_secrets_namespace)
    except ApiException as exc:
        if exc.status == 404:
            raise RuntimeError(
                f"Portal shell database secret {secret_name} not found in "
                f"{_settings.portal_shell_secrets_namespace}"
            ) from exc
        raise

    data = secret.data or {}
    if "DATABASE_URL" in data:
        return base64.b64decode(data["DATABASE_URL"]).decode("utf-8")

    host = base64.b64decode(data["host"]).decode("utf-8")
    port = base64.b64decode(data["port"]).decode("utf-8")
    name = base64.b64decode(data["database"]).decode("utf-8")
    user = base64.b64decode(data["username"]).decode("utf-8")
    password = base64.b64decode(data["password"]).decode("utf-8")
    return (
        f"postgresql+psycopg://{quote(user, safe='')}:{quote(password, safe='')}"
        f"@{host}:{port}/{name}"
    )
