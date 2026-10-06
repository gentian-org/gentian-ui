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
    body = {
        "status": "purged",
        "tenant": "platform",
        "profile": "timesheets",
        "purged": True,
        "complete": True,
        "destroyed": ["database", "files", "credentials", "accessGroup", "provisioningRecords"],
    }
    # The director answers an action it relayed with 202.
    _fake_client(monkeypatch, body, seen, status=202)
    answer = _client().post(
        "/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person
    )
    assert answer.status_code == 202
    assert answer.json() == body
    # An action under /actions/, not the uninstall route and not a DELETE.
    assert (seen["method"], seen["url"]) == ("POST", f"{_base}/actions/purge-app")
    assert seen["json"] == {"profile": "timesheets"}
    assert seen["auth"] == "Bearer person-token"


def test_a_purge_is_waited_for_longer_than_the_director_waits(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "purged", "complete": True}, seen, status=202)
    _client().post("/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person)
    # The director waits five minutes for a purge. A relay that gave up
    # sooner would report a purge that is still destroying things as a
    # service that cannot be reached.
    assert apps.PURGE_TIMEOUT_SECONDS == 330.0
    assert seen["timeout"].read == 330.0
    assert seen["timeout"].read > 300.0
    # Reaching the director at all is not given that long.
    assert seen["timeout"].connect == 15.0


def test_only_a_purge_is_given_that_long(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "uninstalled"}, seen, status=202)
    _client().delete("/api/v1/admin/apps/timesheets", headers=_person)
    assert seen["timeout"].read == 15.0


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (200, {"status": "purged", "purged": True, "complete": True}),
        (202, {"status": "purged", "purged": True, "complete": True}),
        # A purge of an app whose profile is gone: success-shaped, not complete.
        (
            202,
            {
                "status": "partially-purged",
                "purged": True,
                "complete": False,
                "destroyed": ["database", "files"],
                "notExamined": ["objectStorage", "cache", "database.mariadb"],
            },
        ),
        (400, {"error": "not an app: shell names stores the platform keeps for the tenant itself"}),
        (409, {"error": "the app is still installed: uninstall timesheets before purging it"}),
        (
            409,
            {
                "error": "the app is still being removed: timesheets in platform; "
                "nothing was destroyed — purge it once it is gone"
            },
        ),
        (409, {"error": "another operation on this app is running: timesheets in platform"}),
        (
            500,
            {
                "error": "the purge of timesheets in platform did not complete: destroying its "
                "files failed: volume claims still present. Already destroyed: database. "
                "Not attempted: stored credentials, access group, provisioning records. "
                "Nothing is rolled back. Retry the purge: every step is safe to repeat, "
                "and it continues with what is left."
            },
        ),
        (
            504,
            {
                "error": "the operator had not answered purge-app when the director stopped "
                "waiting; what it did before then is not known here. Ask again: the action "
                "is safe to repeat"
            },
        ),
    ],
)
def test_a_purges_answer_comes_back_as_the_director_gave_it(monkeypatch, status, body):
    seen: dict = {}
    _fake_client(monkeypatch, body, seen, status=status)
    answer = _client().post(
        "/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person
    )
    assert answer.status_code == status
    assert answer.json() == body


# -- what uninstalled apps still hold ----------------------------------------


def _usher_settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        USHER_URL="http://usher.test:8080",
    )


def test_the_retained_apps_are_the_ushers_answer_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "tenant": "platform",
        "apps": [
            {
                "profile": "timesheets",
                "state": "retained",
                "profileAvailable": True,
                "kinds": {
                    "database": "present",
                    "files": "present",
                    "credentials": "present",
                    "accessGroup": "present",
                    "objectStorage": "unknown",
                    "cache": "absent",
                },
                "volumes": ["timesheets-release-data"],
            }
        ],
        "unknown": {"objectStorage": "can only be asked of the object store"},
    }
    _fake_client(monkeypatch, body, seen)
    answer = TestClient(_app(_usher_settings())).get("/api/v1/admin/apps/retained", headers=_person)
    assert answer.status_code == 200
    assert answer.json() == body
    # The usher's read for this console's tenant -- not the director, and not
    # an app called "retained".
    assert (seen["method"], seen["url"]) == (
        "GET",
        "http://usher.test:8080/v1/tenants/platform/apps/retained",
    )
    assert seen["auth"] == "Bearer person-token"
    assert seen["timeout"].read == 15.0


@pytest.mark.parametrize(
    ("status", "body"),
    [(403, {"error": "forbidden"}), (400, {"detail": "tenant not found"})],
)
def test_the_retained_read_refused_comes_back_as_it_was(monkeypatch, status, body):
    seen: dict = {}
    _fake_client(monkeypatch, body, seen, status=status)
    answer = TestClient(_app(_usher_settings())).get("/api/v1/admin/apps/retained", headers=_person)
    assert answer.status_code == status
    assert answer.json() == body


def test_the_retained_read_without_an_usher_says_so(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"apps": []}, seen)
    # The director is not asked instead: it does not serve this read.
    answer = _client().get("/api/v1/admin/apps/retained", headers=_person)
    assert answer.status_code == 503
    assert seen == {}


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
    assert client.get("/api/v1/admin/apps/retained").status_code == 401
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
        assert client.get("/api/v1/admin/apps/retained", headers=_person).status_code == 200
        assert seen["url"] == "http://usher.test:8080/v1/tenants/platform/apps/retained"
        purge = client.post(
            "/api/v1/admin/apps/purge", json={"profile": "timesheets"}, headers=_person
        )
        assert purge.status_code == 200
        assert (seen["method"], seen["url"]) == ("POST", f"{_base}/actions/purge-app")
        assert client.delete("/api/v1/admin/apps/timesheets", headers=_person).status_code == 200
        assert (seen["method"], seen["url"]) == ("DELETE", f"{_base}/apps/timesheets")
    finally:
        whole.dependency_overrides.pop(get_settings, None)
