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


def list_tenants() -> list[dict[str, Any]]:
    try:
        result = _custom_objects_api().list_cluster_custom_object(GROUP, VERSION, "tenants")
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    return result.get("items") or []


def cluster_authorization_summary() -> dict[str, int]:
    """Aggregate IntegrationBinding and AppGrant counts across tenant namespaces."""
    tenants = list_tenants()
    bindings = 0
    grants = 0
    grant_ready = 0
    for tenant in tenants:
        name = tenant.get("metadata", {}).get("name", "")
        if not name:
            continue
        ns = tenant_namespace(name)
        binding_items = list_integration_bindings(ns)
        grant_items = list_app_grants(ns)
        bindings += len(binding_items)
        grants += len(grant_items)
        grant_ready += sum(
            1 for g in grant_items if (g.get("status") or {}).get("phase") == "Ready"
        )
    allowed_waivers = 0
    try:
        psp = get_platform_security_policy()
        allowed_waivers = len((psp.get("spec") or {}).get("allowedMacWaivers") or [])
    except ApiException:
        pass
    catalogue_requests = len(list_app_profiles_with_mac_requests())
    return {
        "tenantCount": len(tenants),
        "bindingCount": bindings,
        "grantCount": grants,
        "grantReadyCount": grant_ready,
        "allowedMacWaivers": allowed_waivers,
        "catalogueMacWaiverProfiles": catalogue_requests,
    }


def effective_contract_capabilities(
    binding_caps: list[str],
    contract: str,
    grant_spec: dict[str, Any] | None,
    consumer_app: str,
) -> list[str]:
    """Mirror gentian-os netpolicy.EffectiveContractCapabilities for admin preview."""
    if grant_spec is None:
        return list(binding_caps)
    for consume in grant_spec.get("consume") or []:
        if consume.get("contract") != contract:
            continue
        granted = consume.get("granted") or []
        return list(granted) if granted else []
    _ = consumer_app
    return list(binding_caps)


def list_customizations() -> list[dict[str, Any]]:
    """List every Customization CR cluster-wide, for the customization debt report.

    The operator (see gentian-os internal/controller/customization_controller.go)
    computes status.reviewOverdue, .upstreamStale, .targetVersionDrift and
    .rungAboveRecommended on each record; this call surfaces that live state
    rather than re-deriving it from git, which is the whole point of the debt
    report being a cluster read instead of a CI artifact. See
    gentian-os/docs/app-customization.md §8.3.
    """
    try:
        result = _custom_objects_api().list_cluster_custom_object(GROUP, VERSION, "customizations")
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    return result.get("items") or []


def decode_json_field(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value) if value else default
    return default
