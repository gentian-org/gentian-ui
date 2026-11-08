"""The Resources screen is a client of the director.

Same rule as the cluster's settings: the console holds no credential and
decides nothing. The person's token goes to the director, which asks the
graph whether they may view the tenant or set its plan, reads the cluster's
answers from the operator, and commits the choice as the person. What comes
back is passed on unchanged, except that the screen reads a bare list where
the director answers a list under a key.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import admin, resources
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    # In the order main.py includes them: the screen's own routes before the
    # not-yet-mapped catch-all, which must no longer claim them.
    app.include_router(resources.router, prefix="/api/v1")
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
            seen["method"] = method
            seen["url"] = url
            seen["params"] = params
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def _answer(status, body):
    return lambda m, url: httpx.Response(status, json=body, request=httpx.Request(m, url))


def test_the_state_is_the_directors_answer_for_the_consoles_own_tenant(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch, _answer(200, {"tenant": "platform", "plan": "nodes-2", "quota": []}), seen
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources", headers={"Authorization": "Bearer person"}
    )
    assert r.status_code == 200
    assert r.json()["plan"] == "nodes-2"
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/resources"
    assert seen["auth"] == "Bearer person"


def test_a_platform_operator_asks_about_any_tenant_and_the_director_decides(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(200, {"tenant": "acme"}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources?tenant=acme", headers={"Authorization": "Bearer person"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8090/v1/tenants/acme/resources"


def test_the_plans_arrive_as_the_bare_list_the_screen_reads(monkeypatch):
    seen: dict = {}
    plans = [
        {"name": "nodes-2", "current": True, "selectable": True},
        {"name": "nodes-4", "selectable": False},
    ]
    _fake_client(monkeypatch, _answer(200, {"tenant": "platform", "plans": plans}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources/plans", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json() == plans
    assert not seen["params"]


def test_no_plan_is_chosen_here(monkeypatch):
    """A tenant is moved by the cluster's administrators; this screen writes
    nothing and the director is not asked."""
    seen: dict = {}
    _fake_client(monkeypatch, _answer(202, {"status": "updated"}), seen)
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/resources",
        json={"plan": "nodes-4", "force": False},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code in (404, 405)
    assert "url" not in seen


def test_the_ordering_notice_comes_with_the_state(monkeypatch):
    seen: dict = {}
    state = {
        "tenant": "platform",
        "plan": "nodes-2",
        "ordering": {
            "text": {"en": "Order in the Center"},
            "url": "https://center.example/platform",
        },
    }
    _fake_client(monkeypatch, _answer(200, state), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json()["ordering"]["url"] == "https://center.example/platform"
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/resources"


def test_history_queries_travel_with_the_request(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _answer(200, {"tenant": "platform", "samples": []}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources/usage?from=2026-09-01T00:00:00Z&stepSeconds=3600",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/resources/usage"
    assert seen["params"] == {"from": "2026-09-01T00:00:00Z", "stepSeconds": "3600"}

    _fake_client(monkeypatch, _answer(200, {"tenant": "acme", "intervals": []}), seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources/report?tenant=acme&to=2026-10-01T00:00:00Z",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8090/v1/tenants/acme/resources/report"
    assert seen["params"] == {"to": "2026-10-01T00:00:00Z"}


def test_the_clusters_view_is_every_tenants_state(monkeypatch):
    seen: dict = {}
    states = [{"tenant": "acme", "plan": "nodes-2"}, {"tenant": "platform", "plan": "nodes-4"}]
    _fake_client(
        monkeypatch, _answer(200, {"cluster": "demo", "tenants": states, "unavailable": []}), seen
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/resources/tenants", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json() == states
    assert seen["url"] == "http://usher.test:8090/v1/clusters/demo/resources"


def test_resources_is_no_longer_a_screen_the_console_cannot_show():
    assert admin.screen_for("GET", "/admin/resources") is None
    assert admin.screen_for("GET", "/admin/resources/plans") is None


def test_no_token_is_refused_before_anything_is_forwarded():
    r = TestClient(_app(_settings())).get("/api/v1/admin/resources")
    assert r.status_code == 401


def test_without_an_usher_the_reads_say_so_and_ask_nobody(monkeypatch):
    """The director answers 404 on these now and is not asked instead."""
    seen: dict = {}
    _fake_client(monkeypatch, _answer(200, {}), seen)
    settings = Settings(
        AUTH_DISABLED="true",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    client = TestClient(_app(settings))
    for path in ("", "/plans", "/usage", "/report", "/tenants"):
        r = client.get(f"/api/v1/admin/resources{path}", headers={"Authorization": "Bearer t"})
        assert r.status_code == 503, path
        assert "USHER_URL" in r.json()["detail"]
    assert not seen
