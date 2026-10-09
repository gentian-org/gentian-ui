"""TenantExportSchedule access for the Admin Console.

Schedules are namespaced in the tenant's own namespace. A platform admin may
list across all of them — "which tenants are actually backed up" is a question
only answerable cluster-wide — but every write is confined to one namespace the
caller has already been resolved to.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLURAL = "tenantexportschedules"

# The one schedule the operator derives from BackupPolicy. Editing it directly
# would be reverted on the next reconcile, so the console offers the policy
# instead of a form that quietly loses its input.
MANAGED_NAME = "policy"
MANAGED_BY_LABEL = "app.kubernetes.io/managed-by"
MANAGED_BY_VALUE = "gentian-os"


@lru_cache
def _api() -> client.CustomObjectsApi:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CustomObjectsApi()


def tenant_namespace(tenant: str) -> str:
    return tenant if tenant.startswith("tenant-") else f"tenant-{tenant}"


def tenant_from_namespace(namespace: str) -> str:
    return namespace[len("tenant-"):] if namespace.startswith("tenant-") else namespace


def is_managed(item: dict[str, Any]) -> bool:
    meta = item.get("metadata") or {}
    labels = meta.get("labels") or {}
    return meta.get("name") == MANAGED_NAME and labels.get(MANAGED_BY_LABEL) == MANAGED_BY_VALUE


def list_schedules(tenant: str) -> list[dict[str, Any]]:
    try:
        resp = _api().list_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL
        )
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    return resp.get("items", [])


def list_all_schedules() -> list[dict[str, Any]]:
    """Every tenant's schedules. Platform admins only — the route enforces it."""
    try:
        resp = _api().list_cluster_custom_object(GROUP, VERSION, PLURAL)
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    # Only tenant namespaces: anything else is not a tenant's schedule and has
    # no tenant name to report.
    return [
        item
        for item in resp.get("items", [])
        if str((item.get("metadata") or {}).get("namespace", "")).startswith("tenant-")
    ]


def get_schedule(tenant: str, name: str) -> dict[str, Any] | None:
    try:
        return _api().get_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL, name
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise


def patch_schedule(tenant: str, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Merge-patch the spec, so fields the console does not show are preserved.

    A schedule may carry an app subset or an encryption choice this form has no
    field for; replacing the object wholesale would silently drop them.
    """
    return _api().patch_namespaced_custom_object(
        GROUP, VERSION, tenant_namespace(tenant), PLURAL, name, {"spec": spec}
    )


def delete_schedule(tenant: str, name: str) -> bool:
    try:
        _api().delete_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL, name
        )
    except ApiException as exc:
        if exc.status == 404:
            return False
        raise
    return True
