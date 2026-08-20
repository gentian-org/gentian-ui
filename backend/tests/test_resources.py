"""Resources tab API — plans, ceilings and usage history.

These routes are a thin scope check over the operator's resources API, so the
tests are about the scoping and the translation, not about quota arithmetic:
that is gentian-os's, and is tested there.
"""

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import admin as admin_routes
from app.main import app
from app.services.resource_plans import ResourcesRefused, ResourcesUnavailable


class FakeOperator:
    """Stands in for gentian-os's /v1/tenants/{tenant}/resources endpoints."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.refusal: Exception | None = None
        self.tenants = ["corp", "demo"]

    async def fetch_state(self, settings, tenant, *, actor):
        self.calls.append({"op": "state", "tenant": tenant, "actor": actor})
        if self.refusal:
            raise self.refusal
        return {
            "tenant": tenant,
            "plan": "base",
            "hasQuota": True,
            "quota": [
                {"resource": "limits.cpu", "used": "8", "hard": "32", "usedRatio": 0.25}
            ],
            "actualSource": "metrics.k8s.io",
            "actual": {"limits.cpu": "3100m"},
            "installedApps": 4,
        }

    async def fetch_plans(self, settings, tenant, *, actor, self_service):
        self.calls.append(
            {"op": "plans", "tenant": tenant, "actor": actor, "selfService": self_service}
        )
        if self.refusal:
            raise self.refusal
        return [
            {
                "name": "base",
                "displayName": "Base",
                "tier": 0,
                "quotas": {"cpu": "32"},
                "current": True,
                "selectable": True,
            }
        ]

    async def set_plan(self, settings, tenant, plan, *, actor, self_service, force=False):
        self.calls.append(
            {
                "op": "set",
                "tenant": tenant,
                "plan": plan,
                "actor": actor,
                "selfService": self_service,
                "force": force,
            }
        )
        if self.refusal:
            raise self.refusal
        return {
            "status": "updated",
            "tenant": tenant,
            "plan": plan,
            "previousPlan": "base",
            "message": "committed to the deployments repository",
        }

    async def fetch_usage(self, settings, tenant, *, actor, frm=None, to=None, step_seconds=None):
        self.calls.append({"op": "usage", "tenant": tenant, "from": frm, "to": to})
        if self.refusal:
            raise self.refusal
        return {
            "tenant": tenant,
            "samples": [
                {
                    "observedAt": "2026-08-20T10:00:00Z",
                    "plan": "base",
                    "productSku": "sku-base",
                    "hard": {"limits.cpu": "32"},
                    "used": {"limits.cpu": "8"},
                }
            ],
        }

    async def fetch_report(self, settings, tenant, *, actor, frm=None, to=None):
        self.calls.append({"op": "report", "tenant": tenant})
        if self.refusal:
            raise self.refusal
        return {
            "tenant": tenant,
            "from": "2026-08-01T00:00:00Z",
            "to": "2026-09-01T00:00:00Z",
            "intervals": [
                {
                    "plan": "base",
                    "productSku": "sku-base",
                    "from": "2026-08-01T00:00:00Z",
                    "to": "2026-09-01T00:00:00Z",
                    "seconds": 2678400,
                    "partial": True,
                }
            ],
            "incomplete": False,
        }


@pytest.fixture
def operator(monkeypatch) -> FakeOperator:
    fake = FakeOperator()
    monkeypatch.setattr(admin_routes, "fetch_resource_state", fake.fetch_state)
    monkeypatch.setattr(admin_routes, "fetch_resource_plans", fake.fetch_plans)
    monkeypatch.setattr(admin_routes, "set_resource_plan", fake.set_plan)
    monkeypatch.setattr(admin_routes, "fetch_resource_usage", fake.fetch_usage)
    monkeypatch.setattr(admin_routes, "fetch_resource_report", fake.fetch_report)
    monkeypatch.setattr(admin_routes, "list_tenant_names", lambda: list(fake.tenants))
    return fake


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_state_reports_the_ceiling_and_what_is_under_it(operator: FakeOperator):
    async with await _client() as client:
        response = await client.get("/api/v1/admin/resources")
        assert response.status_code == 200, response.text

    body = response.json()
    assert body["plan"] == "base"
    assert body["quota"][0]["usedRatio"] == 0.25
    assert body["actualSource"] == "metrics.k8s.io"


@pytest.mark.asyncio
async def test_plan_change_is_attributed_to_the_caller(operator: FakeOperator):
    async with await _client() as client:
        response = await client.put("/api/v1/admin/resources", json={"plan": "base-plus-8"})
        assert response.status_code == 200, response.text

    call = next(c for c in operator.calls if c["op"] == "set")
    # The actor reaches the commit message and the billing event, so it must be
    # the person and not the service account.
    assert call["actor"]
    assert call["plan"] == "base-plus-8"
    assert response.json()["previousPlan"] == "base"


# A downgrade that does not fit is 409, not 500: the request is valid and will
# succeed once the tenant frees something, and the console has to be able to
# tell those apart to say the right thing.
@pytest.mark.asyncio
async def test_a_refused_downgrade_keeps_the_operators_status_and_message(operator: FakeOperator):
    operator.refusal = ResourcesRefused(409, "limits.cpu: using 34, plan allows 32")
    async with await _client() as client:
        response = await client.put("/api/v1/admin/resources", json={"plan": "small"})

    assert response.status_code == 409
    assert "using 34" in response.json()["detail"]


@pytest.mark.asyncio
async def test_an_entitlement_refusal_stays_402(operator: FakeOperator):
    operator.refusal = ResourcesRefused(402, "base-plus-32 is above the tenant's entitlement")
    async with await _client() as client:
        response = await client.put("/api/v1/admin/resources", json={"plan": "base-plus-32"})

    assert response.status_code == 402


# An unconfigured resources API is not a broken one. 503 with the reason lets
# the tab say it is not set up, rather than showing a cluster with no plans.
@pytest.mark.asyncio
async def test_an_unreachable_operator_is_reported_as_unavailable(operator: FakeOperator):
    operator.refusal = ResourcesUnavailable("The resources API is not configured for this portal")
    async with await _client() as client:
        response = await client.get("/api/v1/admin/resources/plans")

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


@pytest.mark.asyncio
async def test_usage_history_passes_the_window_through(operator: FakeOperator):
    async with await _client() as client:
        response = await client.get(
            "/api/v1/admin/resources/usage",
            params={"from": "2026-08-01T00:00:00Z", "to": "2026-08-20T00:00:00Z"},
        )
        assert response.status_code == 200, response.text

    call = next(c for c in operator.calls if c["op"] == "usage")
    assert call["from"] == "2026-08-01T00:00:00Z"
    assert call["to"] == "2026-08-20T00:00:00Z"
    assert response.json()["samples"][0]["used"] == {"limits.cpu": "8"}


# `from` is a Python keyword, so the alias has to survive both directions or the
# billing report comes back with a field the console cannot read.
@pytest.mark.asyncio
async def test_the_report_keeps_the_from_field_name(operator: FakeOperator):
    async with await _client() as client:
        response = await client.get("/api/v1/admin/resources/report")
        assert response.status_code == 200, response.text

    body = response.json()
    assert body["from"] == "2026-08-01T00:00:00Z"
    assert body["intervals"][0]["from"] == "2026-08-01T00:00:00Z"
    assert body["intervals"][0]["productSku"] == "sku-base"


@pytest.mark.asyncio
async def test_the_cluster_overview_lists_every_tenant(operator: FakeOperator):
    async with await _client() as client:
        response = await client.get("/api/v1/admin/resources/tenants")
        assert response.status_code == 200, response.text

    assert [row["tenant"] for row in response.json()] == ["corp", "demo"]


# One unreachable tenant must not blank the whole overview: the cluster admin
# still needs to see the others, and a named row with no data says which one is
# in trouble.
@pytest.mark.asyncio
async def test_one_unreachable_tenant_does_not_blank_the_overview(operator: FakeOperator, monkeypatch):
    async def flaky(settings, tenant, *, actor):
        if tenant == "corp":
            raise ResourcesUnavailable("unreachable")
        return {"tenant": tenant, "plan": "base", "hasQuota": True, "quota": []}

    monkeypatch.setattr(admin_routes, "fetch_resource_state", flaky)
    async with await _client() as client:
        response = await client.get("/api/v1/admin/resources/tenants")
        assert response.status_code == 200, response.text

    rows = {row["tenant"]: row for row in response.json()}
    assert rows["corp"]["plan"] == ""
    assert rows["demo"]["plan"] == "base"
