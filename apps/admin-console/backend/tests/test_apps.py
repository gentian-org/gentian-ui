"""The Apps screen's relays: what git declares, and what is done to one app.

Each is a relay and nothing more, so each test pins the same three things:
the person's own token arrives upstream, on the director's route for this
console's tenant, with exactly the body that route accepts -- and the answer,
a refusal included, comes back as the director gave it.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import apps
from app.core import director
from app.core.config import Settings, get_settings

_person = {"Authorization": "Bearer person-token"}
_base = "http://director.test:8080/v1/tenants/platform"


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(apps.router, prefix="/api/v1")
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


def _fake_client(monkeypatch, body, seen: dict, status: int = 200):
    class FakeClient:
        def __init__(self, *a, timeout=None, **kw):
            seen["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"] = method, url
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def _client() -> TestClient:
    return TestClient(_app(_settings()))


# -- what git declares ------------------------------------------------------


def test_the_declared_apps_are_the_directors_answer_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "tenant": "platform",
        "apps": [
            {"profile": "timesheets", "digest": "sha256:" + "a" * 64, "defaultGrant": True},
            {"profile": "wiki", "addons": ["wiki-search"]},
        ],
    }
    _fake_client(monkeypatch, body, seen)
    answer = _client().get("/api/v1/admin/apps", headers=_person)
    assert answer.status_code == 200
    assert answer.json() == body
    assert (seen["method"], seen["url"]) == ("GET", f"{_base}/apps")
    assert seen["auth"] == "Bearer person-token"


def test_the_approved_privileges_are_the_directors_answer_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "tenant": "platform",
        "privileges": [
            {
                "install": "timesheets",
                "privilege": "egress/payroll-api",
                "approver": "u-1",
                "approvedAt": "2026-09-01T10:00:00Z",
                "reason": "payroll export, reviewed",
            }
        ],
    }
    _fake_client(monkeypatch, body, seen)
    answer = _client().get("/api/v1/admin/apps/privileges", headers=_person)
    assert answer.status_code == 200
    assert answer.json() == body
    # A read of the tenant's grants -- not an app called "privileges".
    assert (seen["method"], seen["url"]) == ("GET", f"{_base}/privileges")
    assert seen["auth"] == "Bearer person-token"


# -- for everyone, or per person --------------------------------------------


@pytest.mark.parametrize("everyone", [True, False])
def test_access_states_the_default_grant_and_nothing_else(monkeypatch, everyone):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    answer = _client().put(
        "/api/v1/admin/apps/timesheets/access", json={"everyone": everyone}, headers=_person
    )
    assert answer.status_code == 202
    assert answer.json() == {"status": "updated", "commit": "a1b2c3d4"}
    # The director's install route, on the entry that is already there.
    assert (seen["method"], seen["url"]) == ("POST", f"{_base}/apps/timesheets")
    # No coordinate and no digest: either would fetch a bundle or move the
    # pin, and this request is about who may open the app, not which build.
    assert seen["json"] == {"defaultGrant": everyone}
    assert seen["auth"] == "Bearer person-token"


def test_access_without_saying_which_way_reaches_nobody(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated"}, seen, status=202)
    client = _client()
    # Unstated, null, or something merely shaped like a yes: the director
    # would read an absent defaultGrant as "leave it", and a bare POST to its
    # install route is an install.
    for body in ({}, {"everyone": None}, {"everyone": "maybe"}):
        answer = client.put("/api/v1/admin/apps/timesheets/access", json=body, headers=_person)
        assert answer.status_code == 422
    assert seen == {}


def test_access_refused_names_the_right_it_lacks(monkeypatch):
    seen: dict = {}
    body = {"error": "installing an app for everyone needs can_grant on the tenant"}
    _fake_client(monkeypatch, body, seen, status=403)
    answer = _client().put(
        "/api/v1/admin/apps/timesheets/access", json={"everyone": True}, headers=_person
    )
    assert answer.status_code == 403
    assert answer.json() == body


# -- uninstalling -----------------------------------------------------------


def test_an_uninstall_goes_to_the_director_as_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "uninstalled", "commit": "b2c3d4e5"}, seen, status=202)
    answer = _client().delete("/api/v1/admin/apps/timesheets", headers=_person)
    assert answer.status_code == 202
    assert answer.json() == {"status": "uninstalled", "commit": "b2c3d4e5"}
    assert (seen["method"], seen["url"]) == ("DELETE", f"{_base}/apps/timesheets")
    assert seen["json"] is None
    assert seen["auth"] == "Bearer person-token"


def test_an_uninstall_refused_comes_back_as_the_director_gave_it(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "forbidden"}, seen, status=403)
    answer = _client().delete("/api/v1/admin/apps/timesheets", headers=_person)
    assert answer.status_code == 403
    assert answer.json() == {"error": "forbidden"}


# -- purging ----------------------------------------------------------------


def test_a_purge_is_the_directors_action_for_the_named_app(monkeypatch):
    seen: dict = {}
    body = {"status": "purged", "tenant": "platform", "profile": "timesheets", "purged": True}
    _fake_client(monkeypatch, body, seen)
    answer = _client().post(
        "/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person
    )
    assert answer.status_code == 200
    assert answer.json() == body
    # An action under /actions/, not the uninstall route and not a DELETE.
    assert (seen["method"], seen["url"]) == ("POST", f"{_base}/actions/purge-app")
    assert seen["json"] == {"profile": "timesheets"}
    assert seen["auth"] == "Bearer person-token"
    # It waits for the teardown, so it is given longer than an ordinary relay.
    assert seen["timeout"].read == 60.0


@pytest.mark.parametrize(
    "message",
    [
        "the app is still installed: uninstall timesheets before purging it",
        "the app is still being removed: timesheets in platform; purge it once it is gone",
    ],
)
def test_a_purge_refused_says_why_in_the_clusters_words(monkeypatch, message):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": message}, seen, status=409)
    answer = _client().post(
        "/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person
    )
    assert answer.status_code == 409
    assert answer.json() == {"error": message}


# -- what never reaches the director ----------------------------------------


@pytest.mark.parametrize("name", ["Timesheets", "a_b", "-a", "a.b", "a" * 64])
def test_a_name_that_cannot_be_an_app_is_not_put_in_a_path(monkeypatch, name):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "ok"}, seen)
    client = _client()
    assert client.delete(f"/api/v1/admin/apps/{name}", headers=_person).status_code == 400
    put = client.put(f"/api/v1/admin/apps/{name}/access", json={"everyone": True}, headers=_person)
    assert put.status_code == 400
    purge = client.post("/api/v1/admin/apps/purge", json={"profile": name}, headers=_person)
    assert purge.status_code == 400
    # In a body nothing normalises a dot-dot away before it gets here.
    dots = client.post("/api/v1/admin/apps/purge", json={"profile": ".."}, headers=_person)
    assert dots.status_code == 400
    assert seen == {}


def test_none_of_them_is_relayed_without_a_token(monkeypatch):
    # Authentication is off in this suite (conftest), and the relay still
    # refuses: there is no token to decide by, so nothing reaches the
    # director at all.
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "ok"}, seen, status=202)
    client = _client()
    assert client.get("/api/v1/admin/apps").status_code == 401
    assert client.get("/api/v1/admin/apps/privileges").status_code == 401
    assert client.put("/api/v1/admin/apps/a/access", json={"everyone": True}).status_code == 401
    assert client.delete("/api/v1/admin/apps/a").status_code == 401
    assert client.post("/api/v1/admin/apps/purge", json={"profile": "a"}).status_code == 401
    assert seen == {}


def test_the_whole_app_reaches_these_routes_before_the_catch_all(monkeypatch):
    # admin.py ends in a catch-all under /admin that answers 404 or 501. These
    # routes must be matched before it, and the status read that lives beside
    # the catch-all must still be reached with them in front of it.
    from app.main import app as whole

    seen: dict = {}
    _fake_client(monkeypatch, {"tenant": "platform", "apps": []}, seen)
    settings = Settings(
        AUTH_DISABLED="true",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        USHER_URL="http://usher.test:8080",
    )
    whole.dependency_overrides[get_settings] = lambda: settings
    try:
        client = TestClient(whole)
        assert client.get("/api/v1/admin/apps", headers=_person).status_code == 200
        assert seen["url"] == f"{_base}/apps"
        assert client.get("/api/v1/admin/apps/privileges", headers=_person).status_code == 200
        assert seen["url"] == f"{_base}/privileges"
        assert client.get("/api/v1/admin/apps/status", headers=_person).status_code == 200
        assert seen["url"] == "http://usher.test:8080/v1/tenants/platform/apps/status"
        assert client.delete("/api/v1/admin/apps/timesheets", headers=_person).status_code == 200
        assert (seen["method"], seen["url"]) == ("DELETE", f"{_base}/apps/timesheets")
    finally:
        whole.dependency_overrides.pop(get_settings, None)
