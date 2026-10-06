"""The cluster's half of the App Store.

The store is shown in a window on the desktop and holds nothing of the
cluster's. What it needs it asks of the desktop, and these are the routes the
desktop relays to the director. Three things have to hold: the person's own
token is what reaches the director, the director's answer comes back as it
was given, and the store can reach the routes written down and no others.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import store
from app.core.config import Settings, get_settings

AUTH = {"Authorization": "Bearer person-token"}


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(store.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings(**over) -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        DIRECTOR_URL=over.pop("director_url", "http://director.test:8080"),
        USHER_URL=over.pop("usher_url", "http://usher.test:8090"),
        GENTIAN_CLUSTER_ID=over.pop("cluster_id", "demo"),
        GENTIAN_TENANT=over.pop("tenant", "acme"),
    )


def _director(monkeypatch, answers):
    """A director that records what it was asked and answers from a table.

    answers maps "METHOD /path" to (status, json). An unlisted request is a
    404, which is what the real one says about a route it does not serve.
    """
    seen = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            path = url.split("/v1/tenants/acme", 1)[-1]
            seen.append(
                {
                    "method": method,
                    "url": url,
                    "path": path,
                    "params": params,
                    "json": json,
                    "auth": (headers or {}).get("Authorization"),
                }
            )
            status, body = answers.get(f"{method} {path}", (404, {"error": "not found"}))
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(store.httpx, "AsyncClient", FakeClient)
    return seen


def test_the_callers_token_is_what_reaches_the_director(monkeypatch):
    seen = _director(monkeypatch, {"GET /apps": (200, {"tenant": "acme", "apps": []})})
    r = TestClient(_app(_settings())).get("/api/v1/store/apps", headers=AUTH)

    assert r.status_code == 200
    assert seen[0]["url"] == "http://director.test:8080/v1/tenants/acme/apps"
    assert seen[0]["auth"] == "Bearer person-token"


def test_the_directors_refusal_comes_back_as_it_was_given(monkeypatch):
    """A 403 is the answer, not a failure of the desktop to be papered over."""
    _director(
        monkeypatch,
        {"POST /apps/nextcloud-base-ce": (403, {"error": "you may not install apps in this tenant"})},
    )
    r = TestClient(_app(_settings())).post(
        "/api/v1/store/apps/nextcloud-base-ce",
        json={"coordinate": "main/nextcloud-base-ce"},
        headers=AUTH,
    )
    assert r.status_code == 403
    assert r.json() == {"error": "you may not install apps in this tenant"}


def test_an_install_carries_the_coordinate_and_nothing_else(monkeypatch):
    seen = _director(monkeypatch, {"POST /apps/xwiki-ce": (202, {"status": "recorded"})})
    r = TestClient(_app(_settings())).post(
        "/api/v1/store/apps/xwiki-ce",
        json={"coordinate": "main/xwiki-ce", "tenant": "somebody-else", "force": True},
        headers=AUTH,
    )
    assert r.status_code == 202
    assert seen[0]["json"] == {"coordinate": "main/xwiki-ce"}


def test_the_digest_travels_with_the_install_and_is_a_digest(monkeypatch):
    """The director checks the bundle it fetches against this number, so it
    has to arrive -- and has to be a digest, not something shaped like one."""
    seen = _director(monkeypatch, {"POST /apps/xwiki-ce": (202, {"status": "recorded"})})
    digest = "sha256:" + "ab" * 32
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/store/apps/xwiki-ce",
        json={"coordinate": "main/xwiki-ce", "digest": digest},
        headers=AUTH,
    )
    assert r.status_code == 202
    assert seen[0]["json"] == {"coordinate": "main/xwiki-ce", "digest": digest}

    for bad in ("sha256:abc", "md5:" + "ab" * 32, "sha256:" + "AB" * 32):
        r = client.post(
            "/api/v1/store/apps/xwiki-ce",
            json={"coordinate": "main/xwiki-ce", "digest": bad},
            headers=AUTH,
        )
        assert r.status_code == 400
    assert len(seen) == 1


def test_for_everyone_travels_with_the_install_and_is_a_boolean(monkeypatch):
    """It gives every member access, so it goes on only as the boolean it is."""
    seen = _director(monkeypatch, {"POST /apps/xwiki-ce": (202, {"status": "installed"})})
    client = TestClient(_app(_settings()))
    for stated in (True, False):
        r = client.post(
            "/api/v1/store/apps/xwiki-ce",
            json={"coordinate": "main/xwiki-ce", "defaultGrant": stated},
            headers=AUTH,
        )
        assert r.status_code == 202
        assert seen[-1]["json"] == {"coordinate": "main/xwiki-ce", "defaultGrant": stated}

    for bad in ("true", 1, 0, None, [True], {"value": True}):
        r = client.post(
            "/api/v1/store/apps/xwiki-ce",
            json={"coordinate": "main/xwiki-ce", "defaultGrant": bad},
            headers=AUTH,
        )
        assert r.status_code == 400
    assert len(seen) == 2


def test_a_refusal_to_install_for_everyone_comes_back_as_given(monkeypatch):
    refusal = {"error": "installing an app for everyone needs can_grant on the tenant"}
    _director(monkeypatch, {"POST /apps/xwiki-ce": (403, refusal)})
    r = TestClient(_app(_settings())).post(
        "/api/v1/store/apps/xwiki-ce",
        json={"coordinate": "main/xwiki-ce", "defaultGrant": True},
        headers=AUTH,
    )
    assert r.status_code == 403
    assert r.json() == refusal


@pytest.mark.parametrize(
    "profile",
    ["..", "a/b", "Nextcloud", "-leading", "trailing-", "a" * 64, "a.b"],
)
def test_a_name_that_is_not_a_name_never_reaches_the_director(monkeypatch, profile):
    """These land in a URL path, so a slash or a dot-dot would address another route."""
    seen = _director(monkeypatch, {})
    r = TestClient(_app(_settings())).delete(f"/api/v1/store/apps/{profile}", headers=AUTH)
    assert r.status_code in (400, 404, 405)
    assert seen == []


def test_addons_are_names_too(monkeypatch):
    seen = _director(monkeypatch, {})
    r = TestClient(_app(_settings())).put(
        "/api/v1/store/apps/nextcloud-base-ce/addons",
        json={"addons": ["nextcloud-calendar-ce", "../../clusters"]},
        headers=AUTH,
    )
    assert r.status_code == 400
    assert seen == []


def test_the_context_names_the_store_this_cluster_listens_to(monkeypatch):
    _director(
        monkeypatch,
        {
            "GET /me": (200, {"tenant": "acme", "relations": {"can_install_app": True}}),
            "GET /catalogues": (
                200,
                {"tenant": "acme", "storeUrl": "https://gentian.org/apps", "catalogues": []},
            ),
        },
    )
    r = TestClient(_app(_settings())).get("/api/v1/store/context", headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {
        "cluster": "demo",
        "tenant": "acme",
        "relations": {"can_install_app": True},
        "storeUrl": "https://gentian.org/apps",
        "storeOrigin": "https://gentian.org",
    }


def test_a_store_reached_in_the_clear_is_not_one_to_listen_to(monkeypatch):
    _director(
        monkeypatch,
        {
            "GET /me": (200, {"tenant": "acme", "relations": {}}),
            "GET /catalogues": (200, {"storeUrl": "http://store.example/apps"}),
        },
    )
    r = TestClient(_app(_settings())).get("/api/v1/store/context", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["storeOrigin"] is None


def test_a_cluster_with_no_store_has_no_origin_to_pin(monkeypatch):
    _director(
        monkeypatch,
        {
            "GET /me": (200, {"tenant": "acme", "relations": {}}),
            "GET /catalogues": (200, {"tenant": "acme", "catalogues": []}),
        },
    )
    r = TestClient(_app(_settings())).get("/api/v1/store/context", headers=AUTH)
    assert r.json()["storeUrl"] is None
    assert r.json()["storeOrigin"] is None


def test_somebody_who_may_not_enter_gets_no_context(monkeypatch):
    _director(monkeypatch, {"GET /me": (403, {"error": "forbidden"})})
    r = TestClient(_app(_settings())).get("/api/v1/store/context", headers=AUTH)
    assert r.status_code == 403


def test_without_a_token_nothing_is_asked(monkeypatch):
    seen = _director(monkeypatch, {})
    r = TestClient(_app(_settings())).get("/api/v1/store/apps")
    assert r.status_code == 401
    assert seen == []


def test_a_desktop_that_does_not_know_its_tenant_says_so(monkeypatch):
    seen = _director(monkeypatch, {})
    settings = Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    r = TestClient(_app(settings)).get("/api/v1/store/apps", headers=AUTH)
    assert r.status_code == 503
    assert seen == []


@pytest.mark.parametrize("what,action", [("purge", "purge-app"), ("provision", "provision-app")])
def test_an_action_names_the_profile_and_nothing_else(monkeypatch, what, action):
    seen = _director(monkeypatch, {f"POST /actions/{action}": (202, {"status": "started"})})
    r = TestClient(_app(_settings())).post(f"/api/v1/store/apps/xwiki-ce/{what}", headers=AUTH)
    assert r.status_code == 202
    assert seen[0]["json"] == {"profile": "xwiki-ce"}


def test_a_purge_refused_because_the_app_is_still_there_says_so(monkeypatch):
    _director(
        monkeypatch,
        {"POST /actions/purge-app": (409, {"error": "the app is still installed"})},
    )
    r = TestClient(_app(_settings())).post("/api/v1/store/apps/xwiki-ce/purge", headers=AUTH)
    assert r.status_code == 409
    assert r.json() == {"error": "the app is still installed"}


@pytest.mark.parametrize("path", ["/apps/status", "/resources"])
def test_live_state_is_asked_of_the_usher(monkeypatch, path):
    """How the apps are doing and what the plan has left are what the cluster
    holds right now. The usher answers that; the director answers 404."""
    seen = _director(monkeypatch, {f"GET {path}": (200, {"tenant": "acme"})})
    r = TestClient(_app(_settings())).get(f"/api/v1/store{path}", headers=AUTH)

    assert r.status_code == 200
    assert r.json() == {"tenant": "acme"}
    assert [s["url"] for s in seen] == [f"http://usher.test:8090/v1/tenants/acme{path}"]
    assert seen[0]["auth"] == "Bearer person-token"


@pytest.mark.parametrize("path", ["/apps/status", "/resources"])
def test_without_an_usher_live_state_says_so_and_asks_nobody(monkeypatch, path):
    """The director is not a fallback: a desktop that asked it anyway would
    show a tenant with nothing installed."""
    seen = _director(monkeypatch, {f"GET {path}": (200, {})})
    r = TestClient(_app(_settings(usher_url=None))).get(f"/api/v1/store{path}", headers=AUTH)

    assert r.status_code == 503
    assert "USHER_URL" in r.json()["detail"]
    assert not seen


@pytest.mark.parametrize(
    "body", [{"error": "the operator's API did not answer"}, {"detail": "no such tenant"}]
)
def test_the_ushers_error_comes_back_in_the_shape_it_was_given(monkeypatch, body):
    _director(monkeypatch, {"GET /apps/status": (502, body)})
    r = TestClient(_app(_settings())).get("/api/v1/store/apps/status", headers=AUTH)

    assert r.status_code == 502
    assert r.json() == body


def test_what_git_says_is_installed_is_still_the_directors(monkeypatch):
    seen = _director(monkeypatch, {"GET /apps": (200, {"tenant": "acme", "apps": []})})
    r = TestClient(_app(_settings(usher_url=None))).get("/api/v1/store/apps", headers=AUTH)

    assert r.status_code == 200
    assert seen[0]["url"] == "http://director.test:8080/v1/tenants/acme/apps"
