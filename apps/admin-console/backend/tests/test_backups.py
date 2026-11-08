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
        USHER_URL="http://usher.test:8090",
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
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/backups"
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


def test_this_console_has_no_route_that_makes_a_backup_key():
    """A key made here is a key this console held, and it is designed to hold
    nothing. A person makes their key on their own machine and gives this
    console the public half."""
    client = TestClient(_app(_settings()))
    for path in ("/api/v1/admin/backup-keys/mint", "/api/v1/admin/backup-keys"):
        r = client.post(path, json={}, headers={"Authorization": "Bearer t"})
        assert r.status_code == 404, path


def test_no_token_is_refused_before_anything_is_forwarded():
    assert TestClient(_app(_settings())).get("/api/v1/admin/backups").status_code == 401


def test_one_backup_is_read_from_the_usher(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(200, {"name": "b1", "phase": "Ready"}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/backups/b1", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/backups/b1"


def test_taking_a_backup_stays_at_the_director(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(202, {"name": "b2"}), seen)
    r = TestClient(_app(_settings())).post(
        "/api/v1/admin/backups", json={}, headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 202
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/actions/backup"


def test_the_bundle_is_downloaded_from_the_director(monkeypatch):
    """The usher's token does not fetch a bundle, so this one GET did not move."""
    seen: dict = {}

    class FakeStreamClient:
        def __init__(self, *a, **kw):
            pass

        def build_request(self, method, url, headers=None):
            seen["url"] = url
            return httpx.Request(method, url, headers=headers)

        async def send(self, request, stream=False):
            return httpx.Response(200, stream=httpx.ByteStream(b"bundle"), request=request)

        async def aclose(self):
            pass

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeStreamClient)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/backups/b1/download", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.content == b"bundle"
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/backups/b1/download"


def test_without_an_usher_the_list_says_so_and_asks_nobody(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(200, {"backups": []}), seen)
    settings = Settings(
        AUTH_DISABLED="true",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    r = TestClient(_app(settings)).get(
        "/api/v1/admin/backups", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 503
    assert "USHER_URL" in r.json()["detail"]
    assert not seen
