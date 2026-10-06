# SPDX-License-Identifier: Apache-2.0
"""The Backup screens are clients of the director.

Three screens, one rule: what exists, what a run did, and which policy is in
force are cluster state, relayed by the director to whoever may view the
tenant. The console recomputes no inheritance — a tenant that states nothing
still runs under a policy, and saying what that comes to is the reconciler's
answer, read here.

The writes are not relayed yet and must still answer 501 naming their screen,
because a screen that silently did nothing would be worse than one that says
it cannot.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import admin, backups
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(backups.router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )


def _fake_client(monkeypatch, responder, seen: dict):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"] = method, url
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def _answer(status, body):
    return lambda m, url: httpx.Response(status, json=body, request=httpx.Request(m, url))


def test_the_backups_arrive_as_the_bare_list_the_screen_reads(monkeypatch):
    seen: dict = {}
    items = [{"name": "nightly-1", "phase": "Ready", "platformReadable": True}]
    _fake_client(monkeypatch, _answer(200, {"tenant": "platform", "backups": items}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/backups", headers={"Authorization": "Bearer person"}
    )
    assert r.status_code == 200
    assert r.json() == items
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/backups"
    assert seen["auth"] == "Bearer person"


@pytest.mark.parametrize("status", [403, 404, 502])
def test_the_directors_refusal_is_passed_through_unchanged(monkeypatch, status):
    _fake_client(monkeypatch, _answer(status, {"error": "refused"}), {})
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/backups", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == status


def test_deleting_a_backup_is_an_action_not_a_deletion_of_state(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(202, {"action": "delete-backup", "status": "started"}), seen)
    r = TestClient(_app(_settings())).delete(
        "/api/v1/admin/backups/nightly-1", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 202
    assert seen["method"] == "POST"
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/actions/delete-backup"
    assert seen["json"] == {"name": "nightly-1"}


def test_minting_a_key_still_says_it_is_not_wired():
    """A key minted here is a key this console held, and it is designed to
    hold nothing."""
    r = TestClient(_app(_settings())).post(
        "/api/v1/admin/backup-keys/mint", json={}, headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 501 and "Backup" in r.json()["detail"]


def test_no_token_is_refused_before_anything_is_forwarded():
    assert TestClient(_app(_settings())).get("/api/v1/admin/backups").status_code == 401
