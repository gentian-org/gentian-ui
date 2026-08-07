"""Read Gentian Tenant and AppProfile CRs for shell launcher tiles."""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLATFORM_APP_ANNOTATION = "gentianos.io/platform-app"
APP_PRIVILEGE_REQUESTED_ANNOTATION = "gentianos.io/app-privilege-requested-at"


@lru_cache
def _custom_objects_api() -> client.CustomObjectsApi:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CustomObjectsApi()


def get_tenant(name: str) -> dict[str, Any] | None:
    try:
        return _custom_objects_api().get_cluster_custom_object(
            GROUP,
            VERSION,
            "tenants",
            name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise


def get_app_profile(name: str) -> dict[str, Any] | None:
    try:
        return _custom_objects_api().get_cluster_custom_object(
            GROUP,
            VERSION,
            "appprofiles",
            name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise


def list_installed_profiles(tenant_name: str) -> list[str]:
    """Profiles the tenant has, including the addons enabled inside them.

    An addon is not a separate installed app — it lives in spec.apps[].addons —
    but it is a feature the user can open, so it contributes portal tiles just
    like an app does. Leaving addons out is why enabling Nextcloud Mail produced
    no tile in the app menu.
    """
    tenant = get_tenant(tenant_name)
    if tenant is None:
        return []
    apps = tenant.get("spec", {}).get("apps") or []
    profiles: list[str] = []
    for entry in apps:
        profile = entry.get("profile")
        if profile:
            profiles.append(str(profile))
        for addon in entry.get("addons") or []:
            if addon:
                profiles.append(str(addon))
    return profiles


def is_platform_app(profile: dict[str, Any]) -> bool:
    annotations = profile.get("metadata", {}).get("annotations") or {}
    return annotations.get(PLATFORM_APP_ANNOTATION) == "true"


def list_platform_app_profiles() -> list[str]:
    try:
        profiles = _custom_objects_api().list_cluster_custom_object(GROUP, VERSION, "appprofiles")
        return [
            str(p["metadata"]["name"])
            for p in profiles.get("items", [])
            if is_platform_app(p) and "metadata" in p and "name" in p["metadata"]
        ]
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise


def request_tenant_app_privilege_reconcile(tenant_name: str) -> None:
    """Ask the tenant operator to re-sync app-admins into installed apps immediately."""
    timestamp = (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    try:
        _custom_objects_api().patch_cluster_custom_object(
            group=GROUP,
            version=VERSION,
            plural="tenants",
            name=tenant_name,
            body={"metadata": {"annotations": {APP_PRIVILEGE_REQUESTED_ANNOTATION: timestamp}}},
        )
    except ApiException as exc:
        if exc.status == 404:
            return
        raise
