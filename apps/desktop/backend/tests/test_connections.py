"""The desktop hands a person's own connections on, and decides nothing.

The liaison lists, starts and ends a person's connections to services
outside the workspace. What matters here is that the caller's own token
reaches it unchanged, that a change carries the header the liaison asks
for, that its answers come back as given, and that a workspace without a
liaison says so instead of failing.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import connections
from app.core.config import Settings, get_settings


def _settings(**over) -> Settings:
    values = {
        "AUTH_DISABLED": "true",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "LIAISON_URL": "http://liaison:8000/",
        "GENTIAN_TENANT": "acme",
    }
    values.update(over)
    return Settings(**{k: v for k, v in values.items() if v is not None})


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(connections.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def _fake(monkeypatch, respond):
    seen = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, headers=None):
            seen.append({"method": method, "url": url, "headers": headers or {}})
            return respond(method, url)

    monkeypatch.setattr(connections.httpx, "AsyncClient", FakeClient)
    return seen


AUTH = {"Authorization": "Bearer person-token"}


def test_the_list_is_asked_with_the_callers_token(monkeypatch):
    rows = [{"name": "plaud-agent-bridge-ee", "service": "mcp.plaud.ai", "connected": False}]
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(200, json={"connections": rows}))
    answer = _client(_settings()).get("/api/v1/account/connections", headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {"available": True, "connections": rows}
    assert seen == [
        {
            "method": "GET",
            "url": "http://liaison:8000/api/v1/connections/",
            "headers": {"Authorization": "Bearer person-token"},
        }
    ]


def test_a_workspace_without_a_liaison_has_no_connections(monkeypatch):
    def refuse(m, u):
        raise httpx.ConnectError("no such host")

    _fake(monkeypatch, refuse)
    answer = _client(_settings()).get("/api/v1/account/connections", headers=AUTH)
    assert answer.json() == {"available": False, "connections": []}
    answer = _client(_settings(LIAISON_URL=None)).get("/api/v1/account/connections", headers=AUTH)
    assert answer.json() == {"available": False, "connections": []}


def test_connect_and_disconnect_carry_the_liaisons_header(monkeypatch):
    def respond(m, u):
        if u.endswith("/connect"):
            return httpx.Response(200, json={"url": "https://mcp.plaud.ai/authorize?x=1"})
        return httpx.Response(204)

    seen = _fake(monkeypatch, respond)
    client = _client(_settings())
    answer = client.post("/api/v1/account/connections/plaud-agent-bridge-ee/connect", headers=AUTH)
    assert answer.status_code == 200
    assert answer.json() == {"url": "https://mcp.plaud.ai/authorize?x=1"}
    answer = client.post("/api/v1/account/connections/plaud-agent-bridge-ee/disconnect", headers=AUTH)
    assert answer.status_code == 204
    assert [s["url"] for s in seen] == [
        "http://liaison:8000/api/v1/connections/plaud-agent-bridge-ee/connect",
        "http://liaison:8000/api/v1/connections/plaud-agent-bridge-ee/disconnect",
    ]
    assert all(s["headers"]["X-Liaison-Request"] == "1" for s in seen)
    assert all(s["headers"]["Authorization"] == "Bearer person-token" for s in seen)


def test_a_refusal_comes_back_as_given(monkeypatch):
    _fake(monkeypatch, lambda m, u: httpx.Response(401, json={"detail": "Sign in"}))
    answer = _client(_settings()).get("/api/v1/account/connections", headers=AUTH)
    assert answer.status_code == 401
    assert answer.json() == {"detail": "Sign in"}


def test_a_name_that_is_not_a_bridges_is_refused_before_the_liaison_is_asked(monkeypatch):
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(200, json={}))
    client = _client(_settings())
    for name in ["Plaud", "a_b", "-x", "x" * 70]:
        assert client.post(f"/api/v1/account/connections/{name}/connect", headers=AUTH).status_code == 422
    assert seen == []
