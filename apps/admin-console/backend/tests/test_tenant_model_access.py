"""The console reads and writes a tenant's model access through the director.

What a tenant's apps may use at the model gateway is the tenant manifest's
spec.llm, and the director commits it. The cluster's administrator changes
all of it; the tenant's administrator changes the providers only, while
delegated, and sends the budget and the delegation back as read. Which of the
two the caller is, and whether the body keeps to that, is the director's
answer: this console relays the caller's token and the body as they are, and
hands back whatever comes back, a refusal included.
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
        TENANT_ID="acme",
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


URL = "http://director.test:8080/v1/clusters/demo/tenants/acme/model-access"

ANSWER = {
    "tenant": "acme",
    "providers": ["infomaniak"],
    "budget": {"maxBudget": 50, "budgetDuration": "30d", "rpmLimit": 120},
    "delegated": True,
    "models": [
        {
            "name": "qwen-qwen2.5-7b-instruct",
            "kind": "instance",
            "source": "qwen",
            "state": "declared",
            "allowed": True,
        },
        {
            "name": "infomaniak/gemma-4-31b",
            "kind": "provider",
            "source": "infomaniak",
            "credential": "llm-provider-infomaniak",
            "apiKeyProperty": "infomaniak_api_key",
            "state": "declared",
            "allowed": True,
        },
    ],
}


def test_reading_is_the_directors_answer_unchanged(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=ANSWER, request=httpx.Request(m, url)),
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/cluster/tenants/acme/model-access",
        headers={"Authorization": "Bearer person-token"},
    )

    assert r.status_code == 200
    assert r.json() == ANSWER
    assert seen["calls"] == [("GET", URL)]
    assert seen["auth"] == "Bearer person-token"


def test_a_cluster_administrators_change_is_one_put_with_the_whole_body(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202, json={"status": "updated", "commit": "a1b2c3d4"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    body = {"providers": [], "delegated": False}
    r = TestClient(_app(_settings())).put(
        "/api/v1/cluster/tenants/acme/model-access",
        json=body,
        headers={"Authorization": "Bearer person-token"},
    )

    assert r.status_code == 202
    assert r.json()["commit"] == "a1b2c3d4"
    assert seen["calls"] == [("PUT", URL)]
    # No budget in the body is the budget removed: nothing is filled in here.
    assert seen["json"] == body
    assert seen["auth"] == "Bearer person-token"


def test_a_tenant_administrators_budget_and_delegation_reach_the_director_as_read(monkeypatch):
    """The tenant's administrator changes the providers and sends the rest
    back as the GET answered it; the relay passes it on untouched, so the
    director sees exactly what was read."""
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202, json={"status": "updated", "commit": "e5f6"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    body = {"providers": [], "budget": ANSWER["budget"], "delegated": ANSWER["delegated"]}
    r = TestClient(_app(_settings())).put(
        "/api/v1/cluster/tenants/acme/model-access",
        json=body,
        headers={"Authorization": "Bearer tenant-admin"},
    )

    assert r.status_code == 202
    assert seen["json"] == body
    assert seen["json"]["budget"] == {"maxBudget": 50, "budgetDuration": "30d", "rpmLimit": 120}
    assert seen["json"]["delegated"] is True


@pytest.mark.parametrize(
    "error",
    [
        (
            "changing the providers is not delegated to this tenant's administrators; "
            "the cluster's administrator sets spec.llm.delegated"
        ),
        (
            "the budget and spec.llm.delegated are the cluster's administrator's; "
            "send them as they are and change only the providers"
        ),
        "forbidden",
    ],
)
def test_the_directors_403_is_passed_through_in_its_words(monkeypatch, error):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(403, json={"error": error}, request=httpx.Request(m, url)),
        seen,
    )
    r = TestClient(_app(_settings())).put(
        "/api/v1/cluster/tenants/acme/model-access",
        json={"providers": ["infomaniak"], "budget": None, "delegated": True},
        headers={"Authorization": "Bearer tenant-admin"},
    )

    assert r.status_code == 403
    assert r.json() == {"error": error}


def test_a_refused_read_is_passed_through(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            403, json={"error": "forbidden"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/cluster/tenants/beta/model-access",
        headers={"Authorization": "Bearer tenant-admin"},
    )

    assert r.status_code == 403
    assert r.json() == {"error": "forbidden"}
    assert seen["calls"] == [
        ("GET", "http://director.test:8080/v1/clusters/demo/tenants/beta/model-access")
    ]


def test_an_invalid_body_is_refused_in_the_directors_words(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            422,
            json={"error": "invalid model access: budget.budgetDuration"},
            request=httpx.Request(m, url),
        ),
        seen,
    )
    r = TestClient(_app(_settings())).put(
        "/api/v1/cluster/tenants/acme/model-access",
        json={"budget": {"budgetDuration": "a month"}},
        headers={"Authorization": "Bearer person-token"},
    )

    assert r.status_code == 422
    assert r.json()["error"] == "invalid model access: budget.budgetDuration"


def test_no_token_is_refused_before_anything_is_forwarded(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=ANSWER, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))

    assert client.get("/api/v1/cluster/tenants/acme/model-access").status_code == 401
    assert client.put("/api/v1/cluster/tenants/acme/model-access", json={}).status_code == 401
    assert "calls" not in seen
