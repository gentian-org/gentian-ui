"""The import relays to the director: what a bundle holds, and the choice
whether its custom domain is kept.

The console decides neither. Inspect is asked of the director with the key
given, and the import carries keepCustomDomain through as the person set it;
anything else in the body stays here.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster
from app.core import director
from app.core.config import Settings, get_settings


def _client(monkeypatch, seen: list) -> TestClient:
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen.append((method, url, json))
            if url.endswith("/bundles/inspect"):
                body = {"manifest": {"tenant": "acme", "customDomain": "acme.example"}}
                return httpx.Response(200, json=body)
            return httpx.Response(202, json={"tenant": "acme", "phase": "declared"})

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)
    settings = Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        REGISTRAR_URL="http://registrar.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    app = FastAPI()
    app.include_router(cluster.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


BUNDLE = {"bucket": "gentian-imports", "prefix": "x"}
KEY = {"passphrase": "open sesame"}
AUTH = {"Authorization": "Bearer person-token"}


def test_inspect_is_asked_of_the_director_and_answered_as_it_is(monkeypatch):
    seen: list = []
    r = _client(monkeypatch, seen).post(
        "/api/v1/cluster/bundles/inspect",
        json={"bundle": BUNDLE, "decryption": KEY},
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["manifest"]["customDomain"] == "acme.example"
    assert seen == [
        (
            "POST",
            "http://director.test:8080/v1/clusters/demo/bundles/inspect",
            {"bundle": BUNDLE, "decryption": KEY},
        ),
    ]


def test_the_import_carries_the_custom_domain_choice_and_nothing_else(monkeypatch):
    seen: list = []
    client = _client(monkeypatch, seen)
    for keep in (True, False):
        body = {"bundle": BUNDLE, "decryption": KEY, "keepCustomDomain": keep, "name": "other"}
        r = client.post("/api/v1/cluster/tenants/import", json=body, headers=AUTH)
        assert r.status_code == 202
        assert seen[-1][2] == {"bundle": BUNDLE, "decryption": KEY, "keepCustomDomain": keep}
