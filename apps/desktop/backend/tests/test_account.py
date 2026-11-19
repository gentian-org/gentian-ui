"""The account routes relay the caller's token to the registrar and keep the panel's shapes."""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import account, devices
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="false",
        OIDC_ISSUER="https://id.desk.gentian.org/realms/acme",
        KERNEL_DOMAIN="desk.gentian.org",
        REGISTRAR_URL="http://registrar.test:9445/",
        GENTIAN_TENANT="acme",
    )


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(account.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_current_user] = lambda: {"sub": "mia"}
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

        async def request(self, method, url, headers=None, json=None):
            seen.append(
                {
                    "method": method,
                    "url": url,
                    "auth": (headers or {}).get("Authorization"),
                    "body": json,
                }
            )
            return respond(method, url)

    monkeypatch.setattr(devices.httpx, "AsyncClient", FakeClient)
    return seen


BASE = "http://registrar.test:9445/v1/tenants/acme"
AUTH = {"Authorization": "Bearer mia-token"}


def test_the_profile_is_read_from_the_registrar_with_the_callers_token(monkeypatch):
    seen = _fake(
        monkeypatch,
        lambda m, u: httpx.Response(
            200,
            json={
                "username": "mia",
                "email": "mia@acme.test",
                "firstName": "Mia",
                "lastName": "",
                "totpConfigured": False,
                "totpRequired": True,
            },
        ),
    )
    response = _client(_settings()).get("/api/v1/account/", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "email": "mia@acme.test",
        "firstName": "Mia",
        "lastName": "",
        "username": "mia",
        "totpConfigured": False,
        "totpPending": True,
    }
    assert seen == [
        {"method": "GET", "url": f"{BASE}/account", "auth": "Bearer mia-token", "body": None}
    ]


def test_a_rename_sends_only_the_names(monkeypatch):
    seen = _fake(
        monkeypatch,
        lambda m, u: httpx.Response(200, json={"firstName": "Mia", "lastName": "Muster"}),
    )
    response = _client(_settings()).put(
        "/api/v1/account/profile", headers=AUTH, json={"lastName": "Muster", "email": "evil@x.test"}
    )
    assert response.status_code == 200
    assert seen[0]["url"] == f"{BASE}/actions/update-own-profile"
    assert seen[0]["body"] == {"lastName": "Muster"}


def test_a_refusal_comes_back_with_the_registrars_reason(monkeypatch):
    _fake(monkeypatch, lambda m, u: httpx.Response(403, json={"error": "refused: not here"}))
    response = _client(_settings()).get("/api/v1/account/", headers=AUTH)
    assert response.status_code == 403
    assert response.json()["detail"] == "refused: not here"


def test_sessions_keep_the_panels_shape(monkeypatch):
    _fake(
        monkeypatch,
        lambda m, u: httpx.Response(
            200,
            json={
                "sessions": [
                    {
                        "id": "s1",
                        "ipAddress": "10.0.0.1",
                        "started": "2026-11-19T10:00:00Z",
                        "lastAccess": "2026-11-19T10:05:00Z",
                        "clients": ["gentian-edge-acme"],
                        "current": True,
                    }
                ]
            },
        ),
    )
    response = _client(_settings()).get("/api/v1/account/sessions", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "s1",
            "ipAddress": "10.0.0.1",
            "started": 1795082400000,
            "lastAccess": 1795082700000,
            "current": True,
            "clients": [{"clientName": "gentian-edge-acme"}],
        }
    ]


def test_ending_sessions_names_them_in_the_body(monkeypatch):
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(204))
    client = _client(_settings())
    assert client.delete("/api/v1/account/sessions/s2", headers=AUTH).status_code == 204
    assert client.post("/api/v1/account/sessions/revoke-all", headers=AUTH).status_code == 204
    assert [(s["url"], s["body"]) for s in seen] == [
        (f"{BASE}/actions/end-own-session", {"id": "s2"}),
        (f"{BASE}/actions/end-own-other-sessions", None),
    ]


def test_there_is_no_password_route():
    response = _client(_settings()).post(
        "/api/v1/account/password", headers=AUTH, json={"currentPassword": "a", "newPassword": "b"}
    )
    assert response.status_code in (404, 405)
