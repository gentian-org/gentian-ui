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
        lambda m, url: httpx.Response(
            200, json={"tenant": "platform", "changes": []}, request=httpx.Request(m, url)
        ),
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
        lambda m, url: httpx.Response(
            403, json={"error": "forbidden"}, request=httpx.Request(m, url)
        ),
        {},
    )
    r = TestClient(_app()).get(
        "/api/v1/admin/perimeter/history", headers={"Authorization": "Bearer member"}
    )
    assert r.status_code == 403


def test_traffic_is_the_ushers(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200, json={"totals": [], "series": []}, request=httpx.Request(m, url)
        ),
        seen,
    )
    app = FastAPI()
    app.include_router(perimeter.router, prefix="/api/v1")
    settings = _settings()
    settings.usher_url = "http://usher.test:8080"
    app.dependency_overrides[get_settings] = lambda: settings
    r = TestClient(app).get(
        "/api/v1/admin/perimeter/traffic?from=2026-10-01T00:00:00Z",
        headers={"Authorization": "Bearer approver"},
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8080/v1/tenants/platform/perimeter/traffic"
    assert seen["auth"] == "Bearer approver"


def test_the_trusted_domains_are_read_and_changed_at_the_director(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200,
            json={"tenant": "platform", "delegated": True, "domains": ["example.org"]},
            request=httpx.Request(m, url),
        ),
        seen,
    )
    client = TestClient(_app())
    headers = {"Authorization": "Bearer approver-token"}
    base = "http://director.test:8080/v1/tenants/platform/trusted-domains"

    answer = client.get("/api/v1/admin/perimeter/trusted-domains", headers=headers)
    assert answer.status_code == 200
    assert answer.json()["domains"] == ["example.org"]
    assert (seen["method"], seen["url"]) == ("GET", base)

    assert (
        client.put(
            "/api/v1/admin/perimeter/trusted-domains/example.org", headers=headers
        ).status_code
        == 200
    )
    assert (seen["method"], seen["url"]) == ("PUT", f"{base}/example.org")
    assert seen["auth"] == "Bearer approver-token"

    assert (
        client.delete(
            "/api/v1/admin/perimeter/trusted-domains/example.org", headers=headers
        ).status_code
        == 200
    )
    assert (seen["method"], seen["url"]) == ("DELETE", f"{base}/example.org")


def test_what_is_no_domain_never_reaches_the_director(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json={}, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app())
    headers = {"Authorization": "Bearer approver-token"}
    for name in ("com", "Example.org", "example.org:443", "10.0.0.1", "*.example.org"):
        answer = client.put(f"/api/v1/admin/perimeter/trusted-domains/{name}", headers=headers)
        assert answer.status_code == 400, name
    assert seen == {}


def test_the_directors_refusal_of_a_trusted_domain_comes_back_as_it_is(monkeypatch):
    seen: dict = {}
    refusal = {"error": "trusted domains are not delegated to this tenant"}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(403, json=refusal, request=httpx.Request(m, url)),
        seen,
    )
    answer = TestClient(_app()).put(
        "/api/v1/admin/perimeter/trusted-domains/example.org",
        headers={"Authorization": "Bearer approver-token"},
    )
    assert answer.status_code == 403
    assert answer.json() == refusal
