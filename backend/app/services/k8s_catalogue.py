"""Read Gentian Tenant and AppProfile CRs for shell launcher tiles."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLATFORM_APP_ANNOTATION = "gentianos.io/platform-app"


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
    tenant = get_tenant(tenant_name)
    if tenant is None:
        return []
    apps = tenant.get("spec", {}).get("apps") or []
    profiles: list[str] = []
    for entry in apps:
        profile = entry.get("profile")
        if profile:
            profiles.append(str(profile))
    return profiles


def is_platform_app(profile: dict[str, Any]) -> bool:
    annotations = profile.get("metadata", {}).get("annotations") or {}
    return annotations.get(PLATFORM_APP_ANNOTATION) == "true"
