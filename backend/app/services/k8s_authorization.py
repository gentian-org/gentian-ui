"""Cluster PlatformSecurityPolicy CR access for platform administrators."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLATFORM_SECURITY_POLICY_NAME = "default"


@lru_cache
def _custom_objects_api() -> client.CustomObjectsApi:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CustomObjectsApi()


def get_platform_security_policy() -> dict[str, Any]:
    return _custom_objects_api().get_cluster_custom_object(
        GROUP,
        VERSION,
        "platformsecuritypolicies",
        PLATFORM_SECURITY_POLICY_NAME,
    )


def replace_platform_security_policy(spec: dict[str, Any]) -> dict[str, Any]:
    body = {
        "apiVersion": f"{GROUP}/{VERSION}",
        "kind": "PlatformSecurityPolicy",
        "metadata": {"name": PLATFORM_SECURITY_POLICY_NAME},
        "spec": spec,
    }
    api = _custom_objects_api()
    try:
        return api.replace_cluster_custom_object(
            GROUP,
            VERSION,
            "platformsecuritypolicies",
            PLATFORM_SECURITY_POLICY_NAME,
            body,
        )
    except ApiException as exc:
        if exc.status != 404:
            raise
        return api.create_cluster_custom_object(GROUP, VERSION, "platformsecuritypolicies", body)


def list_app_profiles_with_mac_requests() -> list[dict[str, Any]]:
    """Return catalogue profiles that declare spec.security.macWaivers."""
    api = _custom_objects_api()
    result = api.list_cluster_custom_object(GROUP, VERSION, "appprofiles")
    items = result.get("items") or []
    out: list[dict[str, Any]] = []
    for profile in items:
        waivers = (profile.get("spec") or {}).get("security", {}).get("macWaivers") or []
        if waivers:
            out.append(
                {
                    "name": profile.get("metadata", {}).get("name", ""),
                    "displayName": (profile.get("spec") or {}).get("displayName", ""),
                    "macWaivers": waivers,
                }
            )
    return out


def list_integration_bindings(namespace: str) -> list[dict[str, Any]]:
    try:
        result = _custom_objects_api().list_namespaced_custom_object(
            GROUP,
            VERSION,
            namespace,
            "integrationbindings",
        )
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    return result.get("items") or []


def list_app_grants(namespace: str) -> list[dict[str, Any]]:
    try:
        result = _custom_objects_api().list_namespaced_custom_object(
            GROUP,
            VERSION,
            namespace,
            "appgrants",
        )
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    return result.get("items") or []


def get_app_grant(namespace: str, name: str) -> dict[str, Any] | None:
    try:
        return _custom_objects_api().get_namespaced_custom_object(
            GROUP,
            VERSION,
            namespace,
            "appgrants",
            name,
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise


def replace_app_grant(namespace: str, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    body = {
        "apiVersion": f"{GROUP}/{VERSION}",
        "kind": "AppGrant",
        "metadata": {"name": name, "namespace": namespace},
        "spec": spec,
    }
    return _custom_objects_api().replace_namespaced_custom_object(
        GROUP,
        VERSION,
        namespace,
        "appgrants",
        name,
        body,
    )


def tenant_namespace(tenant: str) -> str:
    return tenant if tenant.startswith("tenant-") else f"tenant-{tenant}"


def decode_json_field(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value) if value else default
    return default
