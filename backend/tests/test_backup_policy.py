"""Backup policy API — cluster defaults, tenant overrides, and who may set them."""

from typing import Any

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.routes import admin as admin_routes
from app.core.config import Settings
from app.main import app


class FakePolicies:
    """Stands in for the cluster-scoped BackupPolicy objects."""

    def __init__(self) -> None:
        self.objects: dict[str, dict[str, Any]] = {}

    def get_policy(self, scope: str, tenant: str | None) -> dict[str, Any] | None:
        name = "default" if scope == "cluster" else str(tenant)
        obj = self.objects.get(name)
        if obj is None:
            return None
        spec = obj.get("spec") or {}
        if spec.get("scope") != scope:
            return None
        if scope == "tenant" and spec.get("tenant") != tenant:
            return None
        return obj

    def put_policy(
        self,
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
        name = "default" if scope == "cluster" else str(tenant)
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
        if recipients:
            spec["encryption"] = {"recipients": recipients}
        if allow_tenant_override is not None and scope == "cluster":
            spec["allowTenantOverride"] = allow_tenant_override
        obj = {"metadata": {"name": name}, "spec": spec, "status": {}}
        self.objects[name] = obj
        return obj

    def delete_policy(self, scope: str, tenant: str | None) -> bool:
        name = "default" if scope == "cluster" else str(tenant)
        if self.get_policy(scope, tenant) is None:
            return False
        del self.objects[name]
        return True


@pytest.fixture
def policies(monkeypatch) -> FakePolicies:
    fake = FakePolicies()
    monkeypatch.setattr(admin_routes, "get_policy", fake.get_policy)
    monkeypatch.setattr(admin_routes, "put_policy", fake.put_policy)
    monkeypatch.setattr(admin_routes, "delete_policy", fake.delete_policy)
    return fake


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_absent_policy_reports_inheriting_not_empty(policies: FakePolicies):
    """Nothing configured is not the same as configured with nothing: the UI
    has to show that a tenant inherits."""
    async with await _client() as client:
        resp = await client.get("/api/v1/admin/backup-policy")
    assert resp.status_code == 200
    assert resp.json()["configured"] is False


@pytest.mark.asyncio
async def test_cluster_default_is_saved_with_its_scope(policies: FakePolicies):
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy/cluster",
            json={
                "destination": {"endpoint": "https://sos-ch-gva-2.exo.io", "bucket": "bundles"},
                "schedule": "0 3 * * *",
                "retention": {"keepLast": 7, "keepMonthly": 12},
            },
        )
    assert resp.status_code == 200
    spec = policies.objects["default"]["spec"]
    assert spec["scope"] == "cluster"
    assert spec["destination"]["endpoint"] == "https://sos-ch-gva-2.exo.io"
    assert spec["retention"] == {"keepLast": 7, "keepMonthly": 12}


@pytest.mark.asyncio
async def test_tenant_override_needs_the_workspace_name_typed(policies: FakePolicies):
    """Sending bundles to your own storage changes where recovery reads from.
    A typed name has to be looked up; a checkbox is clicked through."""
    body = {
        "destination": {"endpoint": "https://my-own.example.org", "bucket": "mine"},
        "schedule": "",
    }
    async with await _client() as client:
        refused = await client.put("/api/v1/admin/backup-policy", json=body)
        assert refused.status_code == 400
        assert "demo" in refused.json()["detail"]
        assert policies.objects == {}

        confirmed = await client.put(
            "/api/v1/admin/backup-policy", json={**body, "confirm": "demo"}
        )
    assert confirmed.status_code == 200
    spec = policies.objects["demo"]["spec"]
    assert spec["scope"] == "tenant" and spec["tenant"] == "demo"


@pytest.mark.asyncio
async def test_schedule_only_override_needs_no_confirmation(policies: FakePolicies):
    """Changing when backups run does not move where they land, so it does not
    warrant the same ceremony."""
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy",
            json={"schedule": "30 1 * * *", "destination": {}},
        )
    assert resp.status_code == 200
    assert policies.objects["demo"]["spec"]["schedule"] == "30 1 * * *"


@pytest.mark.asyncio
async def test_a_tenant_policy_is_never_read_as_the_cluster_one(policies: FakePolicies):
    """A tenant named 'default' must not be able to masquerade as the cluster
    policy — the scope on the object decides, not the name it was fetched by."""
    policies.objects["default"] = {
        "metadata": {"name": "default"},
        "spec": {"scope": "tenant", "tenant": "default"},
        "status": {},
    }
    assert policies.get_policy("cluster", None) is None


@pytest.mark.asyncio
async def test_malformed_input_is_refused_before_it_reaches_the_cluster(policies: FakePolicies):
    async with await _client() as client:
        bad_endpoint = await client.put(
            "/api/v1/admin/backup-policy/cluster",
            json={"destination": {"endpoint": "sos-ch-gva-2.exo.io"}},
        )
        bad_cron = await client.put(
            "/api/v1/admin/backup-policy/cluster",
            json={"destination": {}, "schedule": "0 3 * *"},
        )
    assert bad_endpoint.status_code == 400
    assert "http" in bad_endpoint.json()["detail"]
    assert bad_cron.status_code == 400
    assert policies.objects == {}


@pytest.mark.asyncio
async def test_resetting_an_override_returns_to_inheriting(policies: FakePolicies):
    async with await _client() as client:
        await client.put("/api/v1/admin/backup-policy", json={"schedule": "30 1 * * *"})
        assert "demo" in policies.objects

        resp = await client.delete("/api/v1/admin/backup-policy")
        assert resp.status_code == 204
        assert policies.objects == {}

        gone = await client.delete("/api/v1/admin/backup-policy")
    assert gone.status_code == 404


def _auth_settings() -> Settings:
    s = Settings(ENVIRONMENT="local", KERNEL_DOMAIN="desk.gentian.org")
    s.auth_disabled = False
    return s


def test_only_platform_admins_may_set_cluster_defaults():
    """The cluster default decides where every tenant's bundles go. A tenant
    admin reaching it would redirect storage for workspaces they do not own.

    Asserted against the guard with auth enabled: the route tests above run
    with auth disabled, where every guard returns early and proves nothing.
    """
    settings = _auth_settings()
    tenant_admin = {"groups": ["gentian:tenant:demo:admins"]}
    with pytest.raises(HTTPException) as exc:
        admin_routes._require_platform_admin(tenant_admin, settings)
    assert exc.value.status_code == 403

    platform_admin = {"groups": ["gentian:platform:superadmin"]}
    admin_routes._require_platform_admin(platform_admin, settings)  # no raise


@pytest.mark.asyncio
async def test_cluster_save_audits_against_a_real_tenant(policies: FakePolicies, monkeypatch):
    """The audit log lives in a per-tenant database, so an empty tenant name
    resolves to no database and the write fails — turning a saved policy into
    a 500. The cluster policy audits against the kernel realm instead."""
    seen: dict[str, object] = {}

    async def capture(user, *, tenant, action, target, details):
        seen["tenant"] = tenant

    monkeypatch.setattr(admin_routes, "record_admin_audit", capture)
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy/cluster",
            json={"destination": {}, "schedule": "0 3 * * *"},
        )
    assert resp.status_code == 200
    assert seen["tenant"], "cluster policy audited against an empty tenant"


# The tenant's own backup key: chosen here, in the same settings that decide
# where bundles go and when, because it answers the same question — who ends up
# holding a copy of the workspace's data.
TENANT_KEY = "age17lr9cmnutfg66r92rwc20umdz82sgx3wq86c5lmht8d7sm8dlqpqr3d4zw"


@pytest.mark.asyncio
async def test_tenant_can_choose_its_own_backup_key(policies: FakePolicies):
    """A tenant that names its own key gets bundles the platform cannot read.

    No typed confirmation, unlike an external destination: the bundles stay in
    the platform's storage, so nothing moves. What changes is who can open
    them, which the console warns about at the point of choosing.
    """
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy",
            json={
                "destination": {},
                "schedule": "0 3 * * *",
                "encryption": {"mode": "own", "recipients": [TENANT_KEY]},
            },
        )
    assert resp.status_code == 200
    assert policies.objects["demo"]["spec"]["encryption"] == {"recipients": [TENANT_KEY]}
    assert resp.json()["encryption"] == {"mode": "own", "recipients": [TENANT_KEY]}


@pytest.mark.asyncio
async def test_switching_back_to_the_platform_key_clears_the_tenants(policies: FakePolicies):
    """Going back has to actually go back.

    A recipients list left behind would keep writing bundles the platform
    cannot read while every screen said the platform key was in force — the
    failure only visible on the day someone asks for help restoring.
    """
    async with await _client() as client:
        await client.put(
            "/api/v1/admin/backup-policy",
            json={
                "destination": {},
                "encryption": {"mode": "own", "recipients": [TENANT_KEY]},
            },
        )
        resp = await client.put(
            "/api/v1/admin/backup-policy",
            json={"destination": {}, "encryption": {"mode": "platform"}},
        )
    assert resp.status_code == 200
    # Absent, not empty: absent is what the operator reads as "inherit".
    assert "encryption" not in policies.objects["demo"]["spec"]
    assert resp.json()["encryption"] == {"mode": "platform", "recipients": []}


@pytest.mark.asyncio
async def test_a_mistyped_key_is_refused_while_the_form_is_open(policies: FakePolicies):
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy",
            json={
                "destination": {},
                "encryption": {"mode": "own", "recipients": ["not-a-key"]},
            },
        )
    assert resp.status_code == 400
    assert "age1" in resp.json()["detail"]
    assert policies.objects == {}


@pytest.mark.asyncio
async def test_own_key_with_nothing_named_is_refused(policies: FakePolicies):
    """"Own key" and no key would silently fall back to the platform's, which
    is the opposite of what was asked for."""
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy",
            json={"destination": {}, "encryption": {"mode": "own", "recipients": []}},
        )
    assert resp.status_code == 400
    assert policies.objects == {}


@pytest.mark.asyncio
async def test_the_cluster_key_is_not_editable_from_the_console(policies: FakePolicies):
    """The cluster's recipients are pinned in git and written by the installer.

    That pinning is what makes "the key a bundle is encrypted to is the key the
    repository says it is" checkable. A console that could change them would
    remove the guarantee, and a mistake would make every tenant's bundles
    unreadable by the platform at once.
    """
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-policy/cluster",
            json={
                "destination": {},
                "encryption": {"mode": "own", "recipients": [TENANT_KEY]},
            },
        )
    assert resp.status_code == 400
    assert "installer" in resp.json()["detail"]
    assert policies.objects == {}
