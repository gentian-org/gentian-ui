"""The console reads and writes the cluster's release through the director.

As with the settings: the console holds no credential and decides nothing.
The caller's token goes to the director, which asks whether that person may
audit or configure the cluster, and its answer -- the release view, a 202
with the commit, a refusal -- comes back unchanged. The write is the
director's set-release action, so the body travels as it was sent.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(cluster.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        REGISTRAR_URL="http://registrar.test:8080",
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
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


VIEW = {
    "cluster": "demo",
    "spec": {"version": "v0.5.1", "autoUpgrade": "patch"},
    "status": {"state": "Applied", "revision": "v0.5.1", "image": "0.5.1", "pending": "v0.6.0"},
    "platform": {"version": "0.5.1", "build": "0.5.1"},
    "windowOpen": True,
}


def test_the_release_view_arrives_as_the_director_answers_it(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=VIEW, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/release", headers={"Authorization": "Bearer person-token"})
    assert r.status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/release"
    assert seen["auth"] == "Bearer person-token"
    assert r.json()["status"]["pending"] == "v0.6.0"


def test_setting_the_release_is_the_directors_action_with_the_body_as_sent(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202, json={"status": "updated", "commit": "abc1234"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/cluster/release",
        json={"version": "v0.6.0", "autoUpgrade": "minor"},
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 202
    assert seen["method"] == "POST"
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/actions/set-release"
    assert seen["json"] == {"version": "v0.6.0", "autoUpgrade": "minor"}
    assert r.json()["commit"] == "abc1234"


@pytest.mark.parametrize("status", [400, 403])
def test_a_refusal_comes_back_unchanged(monkeypatch, status):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            status, json={"error": "refused by the director"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/cluster/release", json={"track": "develop"}, headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == status
    assert r.json()["error"] == "refused by the director"
