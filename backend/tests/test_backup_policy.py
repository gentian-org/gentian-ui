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
