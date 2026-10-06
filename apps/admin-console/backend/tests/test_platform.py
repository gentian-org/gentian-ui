"""Three reads relayed from the usher, and the writes, which are the director's."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import admin, platform
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(platform.router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        USHER_URL="http://usher.test:8090",
        GENTIAN_CLUSTER_ID="demo",
    )


def _fake_client(monkeypatch, body, seen: dict, status: int = 200):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"] = method, url
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_integrations_are_asked_of_the_tenant(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {
            "bindings": [{"name": "notes-files", "contract": "files"}],
            "grants": [],
            "summary": {"bindingCount": 1, "grantCount": 0, "grantReadyCount": 0},
            "effectiveAccess": [{"contract": "files", "ungranted": ["write"]}],
        },
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/integrations", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    # The join the screen cares about survives the relay untouched.
    assert r.json()["effectiveAccess"][0]["ungranted"] == ["write"]
    assert seen["url"] == "http://usher.test:8090/v1/tenants/platform/integrations"


def _two_services(monkeypatch, answers: dict, seen: list):
    """A fake that answers by host, for a route that asks two services."""

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen.append((method, url))
            host = "usher" if url.startswith("http://usher.test") else "director"
            status, body = answers[host]
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_customization_is_asked_of_the_usher(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"totalRecords": 0, "carriedDeltas": 0, "byRung": {}}, seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/customization-debt", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://usher.test:8090/v1/clusters/demo/customizations"


def test_platform_security_is_the_clusters_view_with_the_declared_allowlist(monkeypatch):
    """The screen edits the allowlist, so the list it starts from is the one
    git declares -- the director's -- and not the one that last synced. What
    the catalogue asks for is the cluster's view, the usher's."""
    synced = [{"profile": "old", "policy": "p", "scope": "s"}]
    declared = [
        {"profile": "old", "policy": "p", "scope": "s"},
        {"profile": "new", "policy": "p", "scope": "s"},
    ]
    requests = [
        {"name": "new", "displayName": "New", "macWaivers": [{"policy": "p", "scope": "s"}]}
    ]
    seen: list = []
    _two_services(
        monkeypatch,
        {
            "usher": (200, {"allowedMacWaivers": synced, "catalogueRequests": requests}),
            "director": (200, {"allowedMacWaivers": declared}),
        },
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/security-policy", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json() == {"allowedMacWaivers": declared, "catalogueRequests": requests}
    assert seen == [
        ("GET", "http://usher.test:8090/v1/clusters/demo/platform-security"),
        ("GET", "http://director.test:8080/v1/clusters/demo/platform-security"),
    ]


@pytest.mark.parametrize(
    "answers",
    [
        {"usher": (403, {"error": "forbidden"}), "director": (200, {"allowedMacWaivers": []})},
        {
            "usher": (200, {"allowedMacWaivers": [], "catalogueRequests": []}),
            "director": (403, {"error": "forbidden", "request_id": "r1"}),
        },
    ],
)
def test_platform_security_is_refused_when_either_service_refuses(monkeypatch, answers):
    """Half an answer would be an allowlist to edit that nobody declared, or
    approvals with nothing asking for them."""
    _two_services(monkeypatch, answers, [])
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/security-policy", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 403
    assert r.json()["error"] == "forbidden"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/admin/integrations",
        "/api/v1/admin/platform/security-policy",
        "/api/v1/admin/platform/customization-debt",
    ],
)
def test_without_an_usher_the_reads_say_so_and_ask_nobody(monkeypatch, path):
    """The director is not a fallback: it answers 404 on these, and a console
    that asked it anyway would show an empty cluster."""
    seen: dict = {}
    _fake_client(monkeypatch, {}, seen)
    settings = Settings(
        AUTH_DISABLED="true",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    r = TestClient(_app(settings)).get(path, headers={"Authorization": "Bearer t"})
    assert r.status_code == 503
    assert "USHER_URL" in r.json()["detail"]
    assert not seen


@pytest.mark.parametrize(
    "body", [{"error": "the operator's API did not answer"}, {"detail": "no such tenant"}]
)
def test_the_ushers_error_reaches_the_screen_in_either_shape(monkeypatch, body):
    """The usher writes {"error": ...} and passes the operator's own errors
    through as they came, which may be {"detail": ...}. Neither is rewritten."""
    _fake_client(monkeypatch, body, {}, status=502)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/integrations", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 502
    assert r.json() == body


@pytest.mark.parametrize("status", [403, 502])
def test_a_refusal_is_passed_through_unchanged(monkeypatch, status):
    _fake_client(monkeypatch, {"error": "refused"}, {}, status=status)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/integrations", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == status


def test_both_writes_are_commits(monkeypatch):
    """A grant and the waiver allowlist are both declared state, so both
    answer a commit rather than a save."""
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d"}, seen, status=202)
    client = TestClient(_app(_settings()))

    r = client.put(
        "/api/v1/admin/grants/notes",
        json={"consume": [{"contract": "files", "granted": ["read"]}]},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 202
    assert r.json()["commit"] == "a1b2c3d"
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/grants/notes"

    r = client.put(
        "/api/v1/admin/platform/security-policy",
        json={"allowedMacWaivers": []},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 202
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/platform-security"


def test_a_refused_waiver_change_is_the_models_answer(monkeypatch):
    """`can_set_admission` is break-glass in model v1, so an ordinary
    platform administrator is refused. That is correct, and the screen
    shows the refusal rather than pretending the change landed."""
    _fake_client(monkeypatch, {"error": "forbidden"}, {}, status=403)
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/platform/security-policy",
        json={"allowedMacWaivers": [{"profile": "p", "policy": "q", "scope": "r"}]},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 403


def test_no_token_is_refused_before_anything_is_forwarded():
    assert TestClient(_app(_settings())).get("/api/v1/admin/integrations").status_code == 401


def test_the_authorization_view_asks_the_right_scope(monkeypatch):
    """Who holds what, read-only, at two scopes.

    A tenant's bindings are the tenant's and are read under `can_view`; the
    cluster's are read under `can_audit`. The console does not decide either —
    it asks the right object and relays the director's answer, refusals
    included.
    """
    seen: dict = {}
    view = {
        "object": "tenant:platform",
        "bindings": [
            {
                "relation": "admin",
                "groups": ["gentian:tenant:platform:admins"],
                "grants": ["can_view"],
            }
        ],
        "unheld": 0,
    }
    _fake_client(monkeypatch, view, seen)
    client = TestClient(_app(_settings()))

    r = client.get("/api/v1/admin/authorization", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/authorization"
    # The grants survive the relay: without them a reader sees "admin" and has
    # to go and read the model to learn what it means.
    assert r.json()["bindings"][0]["grants"] == ["can_view"]

    r = client.get(
        "/api/v1/admin/authorization?scope=cluster", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/authorization"


def test_a_refusal_of_the_cluster_scope_is_relayed_not_hidden(monkeypatch):
    """A tenant administrator holds no `can_audit`, and the director says so.

    The console must pass that through rather than show an empty table: "you
    may not read this" and "nobody holds anything" are different answers.
    """
    seen: dict = {}
    _fake_client(monkeypatch, {"detail": "forbidden"}, seen, status=403)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/authorization?scope=cluster", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 403


def test_the_cluster_scope_needs_a_cluster_id(monkeypatch):
    """No cluster id configured means no object to ask about, which is this
    console's own gap and is said as one rather than asked of the director."""
    seen: dict = {}
    _fake_client(monkeypatch, {}, seen)
    settings = Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        USHER_URL="http://usher.test:8090",
    )
    r = TestClient(_app(settings)).get(
        "/api/v1/admin/authorization?scope=cluster", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 501
    assert "GENTIAN_CLUSTER_ID" in r.json()["detail"]


def _usher(monkeypatch, status: int, body, seen: dict):
    """A fake usher that records the whole request, the bearer included."""

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"] = method, url
            seen["auth"] = (headers or {}).get("Authorization")
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_the_licence_report_is_asked_of_the_usher_as_the_caller(monkeypatch):
    """The cluster is this console's own, the token is the person's, and the
    report comes back as the usher gave it: the body is the bytes that were
    signed, so nothing here may re-render it."""
    sent = '{"version":1,"sequence":12,"tenants":[{"url":"https://acme.example","users":40}]}'
    answer = {
        "enabled": True,
        "url": "https://licence.example/v1/reports",
        "attempt": {"at": "2026-03-04T05:06:07Z", "outcome": "accepted", "httpStatus": 202},
        "report": {"sequence": 12, "body": sent, "signature": "ed25519=abc", "keyId": "0123"},
    }
    seen: dict = {}
    _usher(monkeypatch, 200, answer, seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/licence-report?cluster=other",
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 200
    assert seen["method"] == "GET"
    assert seen["url"] == "http://usher.test:8090/v1/clusters/demo/licence-report"
    assert seen["auth"] == "Bearer person-token"
    assert r.json() == answer
    assert r.json()["report"]["body"] == sent


def test_a_cluster_that_does_not_report_says_so(monkeypatch):
    _usher(monkeypatch, 200, {"enabled": False}, {})
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/licence-report", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json() == {"enabled": False}


@pytest.mark.parametrize("status", [403, 502])
def test_the_ushers_refusal_of_the_licence_report_comes_back_as_it_is(monkeypatch, status):
    """Who may read the report is the usher's decision, in the usher's words."""
    _usher(monkeypatch, status, {"error": "can_audit on cluster:demo is required"}, {})
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/platform/licence-report", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == status
    assert r.json() == {"error": "can_audit on cluster:demo is required"}


def test_the_licence_report_needs_a_token_before_anything_is_asked(monkeypatch):
    seen: dict = {}
    _usher(monkeypatch, 200, {"enabled": False}, seen)
    r = TestClient(_app(_settings())).get("/api/v1/admin/platform/licence-report")
    assert r.status_code == 401
    assert seen == {}
