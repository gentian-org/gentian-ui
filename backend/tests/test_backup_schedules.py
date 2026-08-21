"""Backup schedule overview — listing, editing, and what must not be edited."""

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import admin as admin_routes
from app.main import app
from app.services.k8s_backup_schedules import MANAGED_BY_LABEL, MANAGED_BY_VALUE


def schedule(
    name: str,
    tenant: str = "demo",
    *,
    managed: bool = False,
    cron: str = "0 3 * * *",
) -> dict[str, Any]:
    labels = {MANAGED_BY_LABEL: MANAGED_BY_VALUE} if managed else {}
    return {
        "metadata": {"name": name, "namespace": f"tenant-{tenant}", "labels": labels},
        "spec": {"schedule": cron, "keepLast": 7},
        "status": {"lastSuccessfulTime": "2026-08-21T03:00:00Z"},
    }


class FakeSchedules:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def list_schedules(self, tenant: str) -> list[dict[str, Any]]:
        return [i for i in self.items if i["metadata"]["namespace"] == f"tenant-{tenant}"]

    def list_all_schedules(self) -> list[dict[str, Any]]:
        return list(self.items)

    def get_schedule(self, tenant: str, name: str) -> dict[str, Any] | None:
        for i in self.items:
            if i["metadata"]["name"] == name and i["metadata"]["namespace"] == f"tenant-{tenant}":
                return i
        return None

    def patch_schedule(self, tenant: str, name: str, spec: dict[str, Any]) -> dict[str, Any]:
        item = self.get_schedule(tenant, name)
        assert item is not None
        item["spec"].update(spec)
        return item

    def delete_schedule(self, tenant: str, name: str) -> bool:
        item = self.get_schedule(tenant, name)
        if item is None:
            return False
        self.items.remove(item)
        return True


@pytest.fixture
def schedules(monkeypatch) -> FakeSchedules:
    fake = FakeSchedules()
    for name in ("list_schedules", "list_all_schedules", "get_schedule", "patch_schedule", "delete_schedule"):
        monkeypatch.setattr(admin_routes, name, getattr(fake, name))
    return fake


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_overview_lists_what_is_configured(schedules: FakeSchedules):
    schedules.items = [schedule("policy", managed=True), schedule("nightly-extra")]
    async with await _client() as client:
        resp = await client.get("/api/v1/admin/backup-schedules")
    assert resp.status_code == 200
    body = resp.json()
    assert [s["name"] for s in body] == ["nightly-extra", "policy"]
    assert body[0]["lastSuccessfulTime"] == "2026-08-21T03:00:00Z"


@pytest.mark.asyncio
async def test_managed_schedules_are_marked_as_such(schedules: FakeSchedules):
    """An admin who cannot tell the derived schedule from a hand-written one
    will edit it and watch the operator revert the change."""
    schedules.items = [schedule("policy", managed=True), schedule("mine")]
    async with await _client() as client:
        body = (await client.get("/api/v1/admin/backup-schedules")).json()
    by_name = {s["name"]: s for s in body}
    assert by_name["policy"]["managed"] is True
    assert by_name["mine"]["managed"] is False


@pytest.mark.asyncio
async def test_a_managed_schedule_cannot_be_edited_or_deleted(schedules: FakeSchedules):
    """Refused rather than accepted-then-reverted: the operator owns this one,
    and a form that silently loses its input is worse than a refusal."""
    schedules.items = [schedule("policy", managed=True)]
    async with await _client() as client:
        edit = await client.put(
            "/api/v1/admin/backup-schedules/policy",
            json={"schedule": "0 5 * * *", "suspended": False},
        )
        gone = await client.delete("/api/v1/admin/backup-schedules/policy")
    assert edit.status_code == 409
    assert gone.status_code == 409
    assert schedules.items, "a managed schedule was deleted"


@pytest.mark.asyncio
async def test_editing_a_hand_written_schedule(schedules: FakeSchedules):
    schedules.items = [schedule("mine")]
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-schedules/mine",
            json={
                "schedule": "30 1 * * *",
                "suspended": True,
                "retention": {"keepLast": 3, "keepMonthly": 6},
            },
        )
    assert resp.status_code == 200
    spec = schedules.items[0]["spec"]
    assert spec["schedule"] == "30 1 * * *"
    assert spec["suspend"] is True
    assert spec["retention"]["keepMonthly"] == 6


@pytest.mark.asyncio
async def test_clearing_a_schedule_is_refused(schedules: FakeSchedules):
    """An empty cron field is not "off" — suspend is. Accepting it would leave
    a schedule the operator cannot parse."""
    schedules.items = [schedule("mine")]
    async with await _client() as client:
        resp = await client.put(
            "/api/v1/admin/backup-schedules/mine", json={"schedule": "", "suspended": False}
        )
    assert resp.status_code == 400
    assert schedules.items[0]["spec"]["schedule"] == "0 3 * * *"


@pytest.mark.asyncio
async def test_deleting_a_hand_written_schedule(schedules: FakeSchedules):
    schedules.items = [schedule("mine")]
    async with await _client() as client:
        resp = await client.delete("/api/v1/admin/backup-schedules/mine")
        missing = await client.delete("/api/v1/admin/backup-schedules/mine")
    assert resp.status_code == 204
    assert missing.status_code == 404
    assert schedules.items == []


@pytest.mark.asyncio
async def test_all_tenants_view_spans_namespaces(schedules: FakeSchedules):
    schedules.items = [schedule("policy", "demo", managed=True), schedule("policy", "acme", managed=True)]
    async with await _client() as client:
        body = (await client.get("/api/v1/admin/backup-schedules?allTenants=true")).json()
    assert {s["tenant"] for s in body} == {"demo", "acme"}
