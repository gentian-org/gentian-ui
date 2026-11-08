"""The console reads and writes the cluster's model settings through the director.

The models a cluster's gateway offers are the Cluster claim's, and changing
the claim is the director's: it asks whether the caller may configure the
cluster, holds the settings to the claim's schema, and commits. This console
relays the caller's own token and the body as they are, and hands back
whatever the director answers -- a refusal included. It has no route into
the gateway and writes nothing to git.
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
            seen.setdefault("calls", []).append((method, url))
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


SETTINGS = {
    "enabled": True,
    "gpuAcceleration": True,
    "instances": [{"name": "qwen", "modelId": "Qwen/Qwen2.5-7B-Instruct"}],
    "providers": [
        {
            "name": "acme",
            "apiBase": "https://models.example/v1",
            "apiKeyProperty": "acme_api_key",
            "models": [{"name": "small", "model": "acme/small"}],
        }
    ],
}

ANSWER = {
    "cluster": "demo",
    "settings": SETTINGS,
    "models": [
        {
            "name": "qwen-qwen2.5-7b-instruct",
            "kind": "instance",
            "source": "qwen",
            "state": "not-served",
            "reason": "The platform does not start the vLLM instance behind this model.",
        },
        {
            "name": "acme/small",
            "kind": "provider",
            "source": "acme",
            "credential": "llm-provider-acme",
            "apiKeyProperty": "acme_api_key",
            "state": "declared",
        },
    ],
}


def test_the_models_are_the_directors_answer_unchanged(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=ANSWER, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/models", headers={"Authorization": "Bearer person-token"})

    assert r.status_code == 200
    # One request, to the director, as the person: nothing is asked of the
    # gateway, and the flag on a model nobody serves is the director's.
    assert seen["calls"] == [("GET", "http://director.test:8080/v1/clusters/demo/models")]
    assert seen["auth"] == "Bearer person-token"
    assert r.json() == ANSWER


def test_a_change_is_one_put_to_the_director_and_comes_back_as_a_commit(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202, json={"status": "updated", "commit": "a1b2c3d4"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.put(
        "/api/v1/cluster/models", json=SETTINGS, headers={"Authorization": "Bearer person-token"}
    )

    assert r.status_code == 202
    assert r.json()["commit"] == "a1b2c3d4"
    assert seen["calls"] == [("PUT", "http://director.test:8080/v1/clusters/demo/models")]
    assert seen["json"] == SETTINGS
    assert seen["auth"] == "Bearer person-token"


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (403, "forbidden"),
        (422, "invalid model settings: spec.llm.providers[0].apiBase"),
        (400, "body must be the model settings"),
        (503, "the cluster's definitions would drop part of it"),
    ],
)
def test_the_directors_refusal_is_passed_through_unchanged(monkeypatch, status, error):
    """A tenant's administrator is refused by the director, not by a hidden
    button here; and a body the claim's schema would refuse is refused in the
    director's words, which name the field."""
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(status, json={"error": error}, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.put(
        "/api/v1/cluster/models", json=SETTINGS, headers={"Authorization": "Bearer person-token"}
    )

    assert r.status_code == status
    assert r.json()["error"] == error


def test_no_token_is_refused_before_anything_is_forwarded(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=ANSWER, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))

    assert client.get("/api/v1/cluster/models").status_code == 401
    assert client.put("/api/v1/cluster/models", json=SETTINGS).status_code == 401
    assert "calls" not in seen
