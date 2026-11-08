"""The desktop asks the usher which tiles a person may open.

What matters here is that the desktop adds no authority of its own, and that
it never papers over a failure. The tile list is the usher's answer about this
person, so the caller's own token must reach it unchanged, the tenant asked
about must be this desktop's own, and whatever comes back -- including a
refusal -- must come back unchanged.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(cluster.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings(**over) -> Settings:
    values = {
        "AUTH_DISABLED": "true",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "USHER_URL": "http://usher.test:8080/",
        "GENTIAN_TENANT": "acme",
    }
    values.update(over)
    return Settings(**{k: v for k, v in values.items() if v is not None})


def _fake(monkeypatch, respond):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            return respond(url, headers or {})

    monkeypatch.setattr(cluster.httpx, "AsyncClient", FakeClient)


def test_the_callers_token_reaches_the_usher_for_this_desktops_tenant(monkeypatch):
    seen = {}

    def respond(url, headers):
        seen["url"] = url
        seen["auth"] = headers.get("Authorization")
        return httpx.Response(
            200, json={"tenant": "acme", "tiles": []}, request=httpx.Request("GET", url)
        )

    _fake(monkeypatch, respond)
    client = TestClient(_app(_settings()))
    # The browser naming another tenant changes nothing: the tenant is this
    # desktop's own, from its configuration.
    r = client.get(
        "/api/v1/cluster/tiles?tenant=other", headers={"Authorization": "Bearer person-token"}
    )

    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8080/v1/tenants/acme/tiles"
    # The person's token, not a credential of the desktop's own.
    assert seen["auth"] == "Bearer person-token"
    assert r.json()["tiles"] == []


@pytest.mark.parametrize("status", [403, 503])
def test_the_ushers_refusal_comes_back_as_it_is(monkeypatch, status):
    """A refusal or a failure is not turned into an empty desktop."""

    def respond(url, headers):
        return httpx.Response(status, json={"error": "x"}, request=httpx.Request("GET", url))

    _fake(monkeypatch, respond)
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/tiles", headers={"Authorization": "Bearer t"})
    assert r.status_code == status


@pytest.mark.parametrize("missing", ["USHER_URL", "GENTIAN_TENANT"])
def test_an_unconfigured_desktop_says_so_rather_than_pretending(missing):
    client = TestClient(_app(_settings(**{missing: None})))
    r = client.get("/api/v1/cluster/tiles", headers={"Authorization": "Bearer t"})
    assert r.status_code == 503


def test_an_unreachable_usher_is_a_gateway_error(monkeypatch):
    def respond(url, headers):
        raise httpx.ConnectError("refused", request=httpx.Request("GET", url))

    _fake(monkeypatch, respond)
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/tiles", headers={"Authorization": "Bearer t"})
    assert r.status_code == 502


@pytest.mark.parametrize("header", [None, ""])
def test_no_token_is_refused_before_anything_is_forwarded(header):
    client = TestClient(_app(_settings()))
    headers = {"Authorization": header} if header is not None else {}
    r = client.get("/api/v1/cluster/tiles", headers=headers)
    assert r.status_code == 401
