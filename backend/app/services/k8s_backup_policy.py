"""BackupPolicy CR access for the Admin Console.

BackupPolicy is cluster-scoped for both scopes, so unlike TenantExport nothing
here is confined to one tenant by construction. Every read filters on
``spec.tenant`` and every write derives the object name from the caller's
resolved tenant — a tenant admin must never be able to read or edit the cluster
policy, nor another tenant's.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from kubernetes import client, config
from kubernetes.client.rest import ApiException

GROUP = "gentianos.io"
VERSION = "v1alpha1"
PLURAL = "backuppolicies"

# The cluster policy is a singleton by this name; a tenant's is named after the
# tenant, which is what makes "which object may this caller write" a derivation
# rather than a parameter.
CLUSTER_POLICY_NAME = "default"

_ENDPOINT_RE = re.compile(r"^https?://[^\s/]+(/.*)?$")
_BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
_CRON_FIELDS = 5


@lru_cache
def _api() -> client.CustomObjectsApi:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    return client.CustomObjectsApi()


def policy_name(scope: str, tenant: str | None) -> str:
    return CLUSTER_POLICY_NAME if scope == "cluster" else str(tenant)


def validate_destination(endpoint: str, bucket: str) -> str | None:
    """Return why a destination is unusable, or None."""
    if endpoint and not _ENDPOINT_RE.match(endpoint):
        return "endpoint must be a full URL including http:// or https://"
    if bucket and not _BUCKET_RE.match(bucket):
        return "bucket must be 3-63 characters, lowercase letters, digits, dots or hyphens"
    return None


def validate_schedule(schedule: str) -> str | None:
    """Reject a cron expression here rather than let the operator find it.

    Five fields is the whole check: anything past that is the operator's cron
    parser, and duplicating it would give two answers to the same question.
    """
    if not schedule:
        return None
    if len(schedule.split()) != _CRON_FIELDS:
        return "schedule must be five cron fields, for example '0 3 * * *'"
    return None


def get_policy(scope: str, tenant: str | None) -> dict[str, Any] | None:
    name = policy_name(scope, tenant)
    try:
        obj = _api().get_cluster_custom_object(GROUP, VERSION, PLURAL, name)
    except ApiException as exc:
        if exc.status == 404:
            return None
        raise
    # A cluster policy that happens to be named after a tenant is not that
    # tenant's, and vice versa: check what the object says, not what we asked
    # for.
    spec = obj.get("spec") or {}
    if spec.get("scope") != scope:
        return None
    if scope == "tenant" and spec.get("tenant") != tenant:
        return None
    return obj


def put_policy(
    scope: str,
    tenant: str | None,
    *,
    destination: dict[str, str] | None,
    schedule: str,
    suspend_schedule: bool,
    retention: dict[str, int] | None,
    recipients: list[str] | None,
    allow_tenant_override: bool | None,
) -> dict[str, Any]:
    name = policy_name(scope, tenant)
    spec: dict[str, Any] = {"scope": scope}
    if scope == "tenant":
        spec["tenant"] = tenant
    if destination:
        spec["destination"] = destination
    if schedule:
        spec["schedule"] = schedule
    if suspend_schedule:
        spec["suspendSchedule"] = True
    if retention:
        spec["retention"] = retention
    # Omitted when empty rather than written as an empty list, because absent
    # means "inherit" and that is how a tenant hands the key back to the
    # platform. An empty list would be a third state the operator has no
    # meaning for.
    if recipients:
        spec["encryption"] = {"recipients": recipients}
    if allow_tenant_override is not None and scope == "cluster":
        spec["allowTenantOverride"] = allow_tenant_override

    body = {
        "apiVersion": f"{GROUP}/{VERSION}",
        "kind": "BackupPolicy",
        "metadata": {"name": name},
        "spec": spec,
    }

    existing = None
    try:
        existing = _api().get_cluster_custom_object(GROUP, VERSION, PLURAL, name)
    except ApiException as exc:
        if exc.status != 404:
            raise

    if existing is None:
        return _api().create_cluster_custom_object(GROUP, VERSION, PLURAL, body)

    body["metadata"]["resourceVersion"] = existing["metadata"]["resourceVersion"]
    return _api().replace_cluster_custom_object(GROUP, VERSION, PLURAL, name, body)


def delete_policy(scope: str, tenant: str | None) -> bool:
    """Remove a policy, returning it to whatever it was inheriting."""
    if get_policy(scope, tenant) is None:
        return False
    try:
        _api().delete_cluster_custom_object(GROUP, VERSION, PLURAL, policy_name(scope, tenant))
    except ApiException as exc:
        if exc.status == 404:
            return False
        raise
    return True
