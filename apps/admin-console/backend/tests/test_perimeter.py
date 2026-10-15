"""The Perimeter tab reads the director's perimeter routes as the caller.

The director answers them under can_expose; the console relays the token and
hands back the answer as it came, a refusal included.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_cluster_settings import _fake_client, _settings

from app.api.routes import perimeter
from app.core.config import get_settings


def _app():
    app = FastAPI()
    app.include_router(perimeter.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: _settings()
    return app


def test_the_surface_and_the_history_are_the_directors(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json={"tenant": "platform", "changes": []}, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app())
    headers = {"Authorization": "Bearer approver-token"}

    assert client.get("/api/v1/admin/perimeter/exposures", headers=headers).status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/perimeter/exposures"
    assert seen["auth"] == "Bearer approver-token"

    assert client.get("/api/v1/admin/perimeter/history", headers=headers).status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/perimeter/history"


def test_a_refusal_arrives_as_it_came(monkeypatch):
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(403, json={"error": "forbidden"}, request=httpx.Request(m, url)),
        {},
    )
    r = TestClient(_app()).get("/api/v1/admin/perimeter/history", headers={"Authorization": "Bearer member"})
    assert r.status_code == 403


def test_traffic_is_the_ushers(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json={"totals": [], "series": []}, request=httpx.Request(m, url)),
        seen,
    )
    app = FastAPI()
    app.include_router(perimeter.router, prefix="/api/v1")
    settings = _settings()
    settings.usher_url = "http://usher.test:8080"
    app.dependency_overrides[get_settings] = lambda: settings
    r = TestClient(app).get("/api/v1/admin/perimeter/traffic?from=2026-10-01T00:00:00Z", headers={"Authorization": "Bearer approver"})
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8080/v1/tenants/platform/perimeter/traffic"
    assert seen["auth"] == "Bearer approver"
