"""Tests for the customization debt report route.

See docs/app-customization.md §8.3 (gentian-os) — the report reads live
Customization CRs and re-derives the debt aggregates from their status. These
tests exercise both the pure aggregation logic and the route end to end, with
the K8s client mocked at the boundary (app.services.k8s_authorization.list_customizations)
rather than hitting a real cluster.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import admin as admin_routes
from app.main import app


def _customization(
    name: str,
    *,
    rung: str,
    scope: str = "profile",
    review_overdue: bool = False,
    upstream_stale: bool = False,
    rung_above_recommended: bool = False,
) -> dict:
    return {
        "metadata": {"name": name, "namespace": "gentian-catalogue"},
        "spec": {
            "summary": f"summary for {name}",
            "target": {"profile": "odoo-cb-base"},
            "rung": rung,
            "scope": scope,
            "owner": "platform-erp",
            "reviewBy": "2027-01-01",
        },
        "status": {
            "phase": "Active",
            "reviewOverdue": review_overdue,
            "upstreamStale": upstream_stale,
            "targetVersionDrift": False,
            "rungAboveRecommended": rung_above_recommended,
        },
    }


def test_customization_record_maps_crd_fields():
    record = admin_routes._customization_record(
        _customization("hide-enterprise-modules", rung="L3", review_overdue=True)
    )
    assert record.name == "hide-enterprise-modules"
    assert record.namespace == "gentian-catalogue"
    assert record.rung == "L3"
    assert record.targetProfile == "odoo-cb-base"
    assert record.reviewOverdue is True
    assert record.upstreamStale is False


@pytest.mark.asyncio
async def test_customization_debt_report_aggregates_by_rung(monkeypatch):
    items = [
        _customization("a", rung="L1"),
        _customization("b", rung="L3"),
        _customization("c", rung="L4", review_overdue=True),
        _customization("d", rung="L5", upstream_stale=True),
        _customization("e", rung="L3", rung_above_recommended=True),
    ]
    monkeypatch.setattr(admin_routes, "list_customizations", lambda: items)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/admin/platform/customization-debt")

    assert response.status_code == 200
    body = response.json()

    assert body["totalRecords"] == 5
    # carriedDeltas = L4 + L5 + L6 — the number the framework says must trend down.
    assert body["carriedDeltas"] == 2
    assert body["byRung"] == {"L0": 0, "L1": 1, "L2": 0, "L3": 2, "L4": 1, "L5": 1, "L6": 0}

    assert [r["name"] for r in body["reviewOverdue"]] == ["c"]
    assert [r["name"] for r in body["upstreamStale"]] == ["d"]
    assert [r["name"] for r in body["rungAboveRecommended"]] == ["e"]
    assert len(body["records"]) == 5


@pytest.mark.asyncio
async def test_customization_debt_report_empty_cluster(monkeypatch):
    monkeypatch.setattr(admin_routes, "list_customizations", lambda: [])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/admin/platform/customization-debt")

    assert response.status_code == 200
    body = response.json()
    assert body["totalRecords"] == 0
    assert body["carriedDeltas"] == 0
    assert body["reviewOverdue"] == []


@pytest.mark.asyncio
async def test_customization_debt_report_surfaces_k8s_errors(monkeypatch):
    def _raise():
        raise RuntimeError("cluster unreachable")

    monkeypatch.setattr(admin_routes, "list_customizations", _raise)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/admin/platform/customization-debt")

    assert response.status_code == 503
