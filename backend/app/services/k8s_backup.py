"""TenantExport CR access for the Admin Console's Backup tab.

Exports are namespaced in the tenant's own namespace, so every call here is
scoped to one tenant by construction — the caller passes a tenant name that the
route has already resolved through ``resolve_admin_tenant``, and nothing in this
module can reach outside it.
"""

from __future__ import annotations

import base64
import re
from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLURAL = "tenantexports"

# A passphrase Secret is created per export and named after it, so a tenant
# admin cannot aim an export at an unrelated Secret in their namespace and have
# the operator copy it into the kernel namespace for them.
PASSPHRASE_SECRET_PREFIX = "tenant-export-passphrase-"
PASSPHRASE_KEY = "passphrase"

# One-off object storage keys for a single export. The field names match what
# the operator's capture Jobs read (backup.DestinationAccessKeyField and its
# pair), so a Secret written here is one they can consume unchanged.
DESTINATION_SECRET_PREFIX = "tenant-export-destination-keys-"
DESTINATION_ACCESS_KEY = "accessKey"
DESTINATION_SECRET_KEY = "secretKey"

_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")


@lru_cache
def _custom_objects_api() -> client.CustomObjectsApi:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CustomObjectsApi()


@lru_cache
def _core_api() -> client.CoreV1Api:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CoreV1Api()


def tenant_namespace(tenant: str) -> str:
    return tenant if tenant.startswith("tenant-") else f"tenant-{tenant}"


def valid_export_name(name: str) -> bool:
    """Names become Job and Secret names, so they must be DNS-safe and short.

    The operator truncates over-long Job names, which is safe but makes the
    resulting objects hard to recognise; rejecting the name here keeps the
    feedback with the person who chose it.
    """
    return bool(_NAME_RE.match(name))


def list_exports(tenant: str) -> list[dict[str, Any]]:
    try:
        result = _custom_objects_api().list_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL
        )
    except ApiException as exc:
        if exc.status == 404:
            return []
        raise
    items = result.get("items") or []
    items.sort(
        key=lambda item: (item.get("metadata") or {}).get("creationTimestamp") or "",
        reverse=True,
    )
    return items


def get_export(tenant: str, name: str) -> dict[str, Any] | None:
    try:
        return _custom_objects_api().get_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL, name
        )
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise


def create_export(
    tenant: str,
    name: str,
    *,
    apps: list[str] | None = None,
    encryption: dict[str, Any] | None = None,
    destination: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "apiVersion": f"{GROUP}/{VERSION}",
        "kind": "TenantExport",
        "metadata": {"name": name, "namespace": tenant_namespace(tenant)},
        "spec": {},
    }
    if apps:
        body["spec"]["apps"] = apps
    if encryption:
        body["spec"]["encryption"] = encryption
    if destination:
        body["spec"]["destination"] = destination
    return _custom_objects_api().create_namespaced_custom_object(
        GROUP, VERSION, tenant_namespace(tenant), PLURAL, body
    )


def passphrase_secret_name(export_name: str) -> str:
    return f"{PASSPHRASE_SECRET_PREFIX}{export_name}"


def create_passphrase_secret(tenant: str, export_name: str, passphrase: str) -> str:
    """Store a passphrase for one export, and return the Secret's name.

    The passphrase reaches the cluster only as this Secret. The operator copies
    it beside the capture Jobs and deletes both copies when the export finishes,
    so the window in which the platform holds it is the length of the export —
    which is the most that can be promised while the encryption runs in-cluster.
    """
    name = passphrase_secret_name(export_name)
    secret = client.V1Secret(
        metadata=client.V1ObjectMeta(
            name=name,
            namespace=tenant_namespace(tenant),
            labels={
                "app.kubernetes.io/managed-by": "gentian-portal",
                "gentianos.io/tenant-export": export_name,
            },
        ),
        type="Opaque",
        data={PASSPHRASE_KEY: base64.b64encode(passphrase.encode()).decode()},
    )
    api = _core_api()
    try:
        api.create_namespaced_secret(namespace=tenant_namespace(tenant), body=secret)
    except ApiException as exc:
        if exc.status != 409:
            raise
        api.replace_namespaced_secret(
            name=name, namespace=tenant_namespace(tenant), body=secret
        )
    return name


def delete_passphrase_secret(tenant: str, export_name: str) -> None:
    """Best-effort cleanup for an export that was never created.

    Without this, a failed create would leave the passphrase sitting in the
    tenant namespace with no export to consume or clean it up.
    """
    try:
        _core_api().delete_namespaced_secret(
            name=passphrase_secret_name(export_name), namespace=tenant_namespace(tenant)
        )
    except ApiException as exc:
        if exc.status != 404:
            raise


def destination_secret_name(export_name: str) -> str:
    return f"{DESTINATION_SECRET_PREFIX}{export_name}"


def create_destination_secret(
    tenant: str, export_name: str, access_key: str, secret_key: str
) -> str:
    """Store one-off object storage keys for one export, and return the name.

    The same shape as the passphrase, and for the same reason: the keys reach
    the cluster only as this Secret, the operator stages a copy beside the
    capture Jobs and removes both when the export ends, so the platform holds
    them for the length of one backup rather than standing.

    Named from the export, never from anything the caller supplies — the
    operator reads this name out of the spec, and a caller who could choose it
    could point the export at a Secret they do not own.
    """
    name = destination_secret_name(export_name)
    secret = client.V1Secret(
        metadata=client.V1ObjectMeta(
            name=name,
            namespace=tenant_namespace(tenant),
            labels={
                "app.kubernetes.io/managed-by": "gentian-portal",
                "gentianos.io/tenant-export": export_name,
            },
        ),
        type="Opaque",
        data={
            DESTINATION_ACCESS_KEY: base64.b64encode(access_key.encode()).decode(),
            DESTINATION_SECRET_KEY: base64.b64encode(secret_key.encode()).decode(),
        },
    )
    api = _core_api()
    try:
        api.create_namespaced_secret(namespace=tenant_namespace(tenant), body=secret)
    except ApiException as exc:
        if exc.status != 409:
            raise
        api.replace_namespaced_secret(
            name=name, namespace=tenant_namespace(tenant), body=secret
        )
    return name


def delete_destination_secret(tenant: str, export_name: str) -> None:
    """Best-effort cleanup for an export that was never created."""
    try:
        _core_api().delete_namespaced_secret(
            name=destination_secret_name(export_name), namespace=tenant_namespace(tenant)
        )
    except ApiException as exc:
        if exc.status != 404:
            raise


def delete_export(tenant: str, name: str) -> bool:
    try:
        _custom_objects_api().delete_namespaced_custom_object(
            GROUP, VERSION, tenant_namespace(tenant), PLURAL, name
        )
    except ApiException as exc:
        if exc.status == 404:
            return False
        raise
    return True
