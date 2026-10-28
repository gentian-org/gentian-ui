"""Tenant Settings saves one form as the director's three declarations.

Country first, because the director fills an empty currency from it; then the
languages; then the organisation with the display name. The first refusal is
the answer, and what follows it is not sent.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import tenant_settings
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(tenant_settings.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="acme",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )


def _fake_client(monkeypatch, responder, seen: list):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen.append((method, url, json))
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_the_form_is_saved_as_country_languages_then_organization(monkeypatch):
    seen: list = []
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200, json={"status": "updated"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/tenant-settings",
        headers={"Authorization": "Bearer t"},
        json={
            "displayName": "Acme",
            "country": "CH",
            "locales": ["de", "en"],
            "organization": {"legalName": "Acme AG", "timeZone": "Europe/Zurich"},
        },
    )
    assert r.status_code == 200
    assert [(m, url.rsplit("/", 1)[-1]) for m, url, _ in seen] == [
        ("PUT", "country"),
        ("PUT", "locales"),
        ("PUT", "organization"),
    ]
    assert seen[0][2] == {"country": "CH"}
    assert seen[1][2] == {"locales": ["de", "en"]}
    assert seen[2][2] == {
        "displayName": "Acme",
        "organization": {"legalName": "Acme AG", "timeZone": "Europe/Zurich"},
    }
    assert all("/v1/tenants/acme/" in url for _, url, _ in seen)


def test_the_first_refusal_is_the_answer(monkeypatch):
    seen: list = []

    def responder(m, url):
        status = 400 if url.endswith("/country") else 200
        return httpx.Response(
            status, json={"error": "a country is two letters"}, request=httpx.Request(m, url)
        )

    _fake_client(monkeypatch, responder, seen)
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/tenant-settings",
        headers={"Authorization": "Bearer t"},
        json={"country": "Schweiz", "organization": {}},
    )
    assert r.status_code == 400
    assert len(seen) == 1


def test_reading_asks_the_director_for_the_organization(monkeypatch):
    seen: list = []
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200, json={"displayName": "Acme", "missing": ["country"]}, request=httpx.Request(m, url)
        ),
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/tenant-settings", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200 and r.json()["missing"] == ["country"]
    assert seen[0][1].endswith("/v1/tenants/acme/organization")
