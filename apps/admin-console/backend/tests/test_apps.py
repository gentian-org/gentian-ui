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


def test_the_public_addresses_are_the_directors_answer_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "tenant": "platform",
        "live": [],
        "expired": [],
        "reviewDue": [],
        "entries": [
            {
                "install": "cloud",
                "exposureName": "shares",
                "state": "requested",
                "host": "share.demo.example",
                "paths": ["/s/"],
                "authMode": "none",
                "anyoneWithoutSignIn": True,
                "mainAddress": False,
            }
        ],
    }
    _fake_client(monkeypatch, body, seen)
    answer = _client().get("/api/v1/admin/apps/exposures", headers=_person)
    assert answer.status_code == 200
    assert answer.json() == body
    # A read of the tenant's entries -- not an app called "exposures".
    assert (seen["method"], seen["url"]) == ("GET", f"{_base}/exposures")
    assert seen["auth"] == "Bearer person-token"


def test_a_refused_read_of_the_public_addresses_is_passed_on(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "you may not see this tenant"}, seen, status=403)
    answer = _client().get("/api/v1/admin/apps/exposures", headers=_person)
    assert answer.status_code == 403


# -- approving and withdrawing a public address -----------------------------

_entry = "/api/v1/admin/apps/exposures/cloud/shares"


def test_an_approval_is_the_directors_for_this_tenant_as_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    sent = {"reason": "shared calendars", "expiresAt": "2027-03-31T23:59:59Z"}
    answer = _client().put(_entry, json=sent, headers=_person)
    assert answer.status_code == 202
    assert answer.json() == {"status": "updated", "commit": "a1b2c3d4"}
    assert (seen["method"], seen["url"]) == ("PUT", f"{_base}/exposures/cloud/shares")
    # The person's own token, and exactly what they sent.
    assert seen["auth"] == "Bearer person-token"
    assert seen["json"] == sent


def test_an_approval_with_nothing_said_sends_nothing_said(monkeypatch):
    """No expiry, no reason, not the main address: an empty body, and no key
    this relay made up -- an absent acknowledgement stays absent."""
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    assert _client().put(_entry, json={}, headers=_person).status_code == 202
    assert seen["json"] == {}


def test_the_main_address_travels_only_as_the_person_sent_it(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    client = _client()
    client.put(_entry, json={"apex": True, "acknowledgeMainAddressRule": True}, headers=_person)
    assert seen["json"] == {"apex": True, "acknowledgeMainAddressRule": True}
    # Asked for without the acknowledgement: it goes as it is, and the
    # director is the one that refuses it.
    client.put(_entry, json={"apex": True}, headers=_person)
    assert seen["json"] == {"apex": True}
    client.put(_entry, json={"apex": True, "acknowledgeMainAddressRule": False}, headers=_person)
    assert seen["json"] == {"apex": True, "acknowledgeMainAddressRule": False}


@pytest.mark.parametrize(
    "body",
    [
        # Fields the director's approval reads and the console's dialog does
        # not offer, the review date among them.
        {"reviewAt": "2036-01-01T00:00:00Z"},
        {"reason": "x", "owner": "somebody-else"},
        {"tenant": "other"},
        {"install": "wiki", "exposureName": "api"},
        {"apexAcknowledgedBy": "somebody-else"},
        # Something merely shaped like a yes is not one.
        {"apex": True, "acknowledgeMainAddressRule": "true"},
        {"apex": True, "acknowledgeMainAddressRule": 1},
        {"apex": "yes"},
        {"reason": 7},
        {"expiresAt": 20270331},
    ],
)
def test_an_approval_saying_anything_else_reaches_nobody(monkeypatch, body):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated"}, seen, status=202)
    assert _client().put(_entry, json=body, headers=_person).status_code == 422
    assert seen == {}


def test_a_withdrawal_is_the_directors_for_this_tenant_as_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "0f1e2d3c"}, seen, status=202)
    answer = _client().delete(_entry, headers=_person)
    assert answer.status_code == 202
    assert answer.json() == {"status": "updated", "commit": "0f1e2d3c"}
    assert (seen["method"], seen["url"]) == ("DELETE", f"{_base}/exposures/cloud/shares")
    assert seen["auth"] == "Bearer person-token"
    assert seen["json"] is None


@pytest.mark.parametrize("method", ["put", "delete"])
def test_the_tenant_is_never_the_callers_to_choose(monkeypatch, method):
    """The tenant is the one this console runs in. Nothing in the path, the
    query or a header moves the request to another."""
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    client = _client()
    kwargs = {"json": {}} if method == "put" else {}
    answer = getattr(client, method)(
        _entry + "?tenant=other&t=other",
        headers={**_person, "X-Tenant": "other", "X-Gentian-Tenant": "other"},
        **kwargs,
    )
    assert answer.status_code == 202
    assert seen["url"] == f"{_base}/exposures/cloud/shares"
    # A name that would climb out of the entry's path is not a name.
    # (Encoded, so that it is this API that reads the dots and not the test's
    # own client that folds them away.)
    for install, name in (
        ("%2e%2e", "shares"),
        ("cloud", "%2e%2e"),
        ("other%2Fexposures", "x"),
        ("a.b", "shares"),
        ("Cloud", "shares"),
    ):
        seen.clear()
        refused = getattr(client, method)(
            f"/api/v1/admin/apps/exposures/{install}/{name}", headers=_person, **kwargs
        )
        assert refused.status_code in (400, 404, 405)
        assert seen == {}
    # No route takes a tenant before the entry.
    seen.clear()
    longer = getattr(client, method)(
        "/api/v1/admin/apps/exposures/other/cloud/shares", headers=_person, **kwargs
    )
    assert longer.status_code in (404, 405)
    assert seen == {}


@pytest.mark.parametrize(
    ("status", "words"),
    [
        (403, "you may not publish for this tenant"),
        (422, "the profile of website does not declare entry site. Nothing was changed"),
        (409, "the main address is already held by website/site"),
        (400, "a website on the cluster's main address needs your acknowledgement"),
    ],
)
@pytest.mark.parametrize("method", ["put", "delete"])
def test_a_refusal_arrives_with_the_directors_status_and_words(monkeypatch, method, status, words):
    seen: dict = {}
    refusal = {"error": words, "request_id": "r-1"}
    _fake_client(monkeypatch, refusal, seen, status=status)
    kwargs = {"json": {"reason": "x"}} if method == "put" else {}
    answer = getattr(_client(), method)(_entry, headers=_person, **kwargs)
    assert answer.status_code == status
    assert answer.json() == refusal


def test_an_entry_already_as_asked_is_the_directors_200(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "unchanged"}, seen, status=200)
    answer = _client().put(_entry, json={}, headers=_person)
    assert (answer.status_code, answer.json()) == (200, {"status": "unchanged"})


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
def test_an_approval_from_a_page_on_another_origin_is_refused(monkeypatch, method):
    """The real application: the origin check every state-changing route of
    this API sits behind covers these two, and a refused request reaches
    neither the route nor the director."""
    from app.main import app

    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "a1b2c3d4"}, seen, status=202)
    client = TestClient(app)
    kwargs = {"json": {"reason": "x"}} if method == "PUT" else {}
    for headers in (
        {"Origin": "https://evil.example.com"},
        {"Origin": "null"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Sec-Fetch-Site": "same-site"},
    ):
        refused = client.request(method, _entry, headers={**_person, **headers}, **kwargs)
        assert refused.status_code == 403
        assert refused.json()["reason"] in ("origin_mismatch", "cross_site_request")
    assert seen == {}


@pytest.mark.parametrize("method", ["post", "patch"])
def test_an_entry_takes_an_approval_and_a_withdrawal_and_nothing_else(monkeypatch, method):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated"}, seen)
    answer = getattr(_client(), method)(_entry, json={}, headers=_person)
    assert answer.status_code in (404, 405)
    assert seen == {}


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


# -- what newer builds left behind -------------------------------------------

_residue = {
    "tenant": "platform",
    "profile": "timesheets",
    "profiles": ["timesheets", "timesheets-export"],
    "residue": [
        {
            "kind": "OIDCPackCatalog",
            "name": "timesheets-old-oidc",
            "profile": "timesheets",
            "class": "dropped",
            "reason": "it carries the label gentianos.io/profile-name: timesheets, and the "
            "bundle now materialised for timesheets does not bring it",
            "created": "2026-08-14T09:00:00Z",
            "removable": True,
            "oidc": {"effective": "contested", "clients": [], "contested": ["timesheets"]},
        }
    ],
    "removableBy": "platform",
    "incomplete": [],
    "oidcRule": "A client is configured from the first OIDCPackCatalog that holds it.",
}


def test_an_apps_leftovers_are_the_ushers_answer_untouched(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _residue, seen)
    answer = TestClient(_app(_usher_settings())).get(
        "/api/v1/admin/apps/timesheets/residue", headers=_person
    )
    assert answer.status_code == 200
    # Untouched: who may remove them is the server's word, not this relay's.
    assert answer.json() == _residue
    assert (seen["method"], seen["url"]) == (
        "GET",
        "http://usher.test:8080/v1/tenants/platform/apps/timesheets/residue",
    )
    assert seen["json"] is None
    assert seen["auth"] == "Bearer person-token"


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (403, {"error": "forbidden"}),
        (404, {"detail": "not installed in this tenant: timesheets in platform"}),
        (502, {"error": "the operator's API did not answer"}),
    ],
)
def test_the_leftovers_read_refused_comes_back_as_it_was(monkeypatch, status, body):
    seen: dict = {}
    _fake_client(monkeypatch, body, seen, status=status)
    answer = TestClient(_app(_usher_settings())).get(
        "/api/v1/admin/apps/timesheets/residue", headers=_person
    )
    assert answer.status_code == status
    assert answer.json() == body


def test_the_leftovers_read_needs_the_usher(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, _residue, seen)
    # No usher configured: said so, and the director is not asked instead.
    answer = _client().get("/api/v1/admin/apps/timesheets/residue", headers=_person)
    assert answer.status_code == 503
    assert seen == {}


def test_removing_a_leftover_is_the_directors_action_for_this_app(monkeypatch):
    seen: dict = {}
    body = {
        "status": "deleted",
        "deleted": {"kind": "ConfigMap", "name": "timesheets.old-page", "class": "dropped"},
        "message": "the ConfigMap timesheets.old-page was deleted, asked for by uma@example.com",
    }
    _fake_client(monkeypatch, body, seen, status=202)
    answer = _client().post(
        "/api/v1/admin/apps/timesheets/residue/remove",
        json={"kind": "ConfigMap", "name": "timesheets.old-page", "confirm": "timesheets.old-page"},
        headers=_person,
    )
    assert answer.status_code == 202
    assert answer.json() == body
    # The tenant's action, for this console's tenant and this app -- never
    # the cluster's removal, which lists and removes far more.
    assert (seen["method"], seen["url"]) == (
        "POST",
        f"{_base}/apps/timesheets/actions/remove-residue",
    )
    # Only what was given: no namespace was, so none travels.
    assert seen["json"] == {
        "kind": "ConfigMap",
        "name": "timesheets.old-page",
        "confirm": "timesheets.old-page",
    }
    assert seen["auth"] == "Bearer person-token"
    assert seen["timeout"].read == 15.0


def test_a_removal_carries_the_namespace_and_no_confirmation_it_was_not_given(monkeypatch):
    seen: dict = {}
    needs = {
        "error": "removing the ConfigMap timesheets.old-page deletes it from the cluster",
        "confirmField": "confirm",
        "confirmWith": "timesheets.old-page",
        "dangerous": True,
        "requiresRetype": True,
    }
    _fake_client(monkeypatch, needs, seen, status=428)
    answer = _client().post(
        "/api/v1/admin/apps/timesheets/residue/remove",
        json={
            "kind": "ConfigMap",
            "name": "timesheets.old-page",
            "namespace": "kernel-provisioning",
        },
        headers=_person,
    )
    # The director asks for the name again; this relay never supplies it.
    assert answer.status_code == 428
    assert answer.json() == needs
    assert seen["json"] == {
        "kind": "ConfigMap",
        "name": "timesheets.old-page",
        "namespace": "kernel-provisioning",
    }


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (202, {"status": "deleting", "deleted": {"kind": "Customization", "name": "t.old"}}),
        (
            403,
            {
                "error": "These pieces are shared by every tenant that uses this app. "
                "Ask the platform admin to remove them.",
                "reason": "shared",
                "removableBy": "platform",
            },
        ),
        (403, {"error": "forbidden"}),
        (404, {"error": "not installed in this tenant: timesheets in platform"}),
        (
            409,
            {"error": "Argo CD finds it declared. Nothing was deleted", "reason": "still-declared"},
        ),
        (409, {"error": "not something a newer build left behind", "reason": "not-residue"}),
        (502, {"error": "the operator's API did not answer"}),
    ],
)
def test_a_removals_answer_comes_back_as_the_director_gave_it(monkeypatch, status, body):
    seen: dict = {}
    _fake_client(monkeypatch, body, seen, status=status)
    answer = _client().post(
        "/api/v1/admin/apps/timesheets/residue/remove",
        json={"kind": "ConfigMap", "name": "timesheets.old-page", "confirm": "timesheets.old-page"},
        headers=_person,
    )
    assert answer.status_code == status
    assert answer.json() == body


def test_a_removal_that_names_no_piece_or_no_app_reaches_nobody(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "deleted"}, seen, status=202)
    client = _client()
    for body in ({}, {"kind": "ConfigMap"}, {"name": "timesheets.old-page"}):
        answer = client.post(
            "/api/v1/admin/apps/timesheets/residue/remove", json=body, headers=_person
        )
        assert answer.status_code == 422
    # A name that would address another route of the director.
    for profile in ("..", "Time Sheets", "a_b"):
        answer = client.post(
            f"/api/v1/admin/apps/{profile}/residue/remove",
            json={"kind": "ConfigMap", "name": "x", "confirm": "x"},
            headers=_person,
        )
        assert answer.status_code in (400, 404)
        answer = TestClient(_app(_usher_settings())).get(
            f"/api/v1/admin/apps/{profile}/residue", headers=_person
        )
        assert answer.status_code in (400, 404)
    assert seen == {}


def test_a_removal_from_another_origin_is_refused_before_anything_is_asked(monkeypatch):
    """The real application: the origin check stands in front of this POST as
    it does in front of every state-changing request."""
    from app.main import app

    seen: dict = {}
    _fake_client(monkeypatch, {"status": "deleted"}, seen, status=202)
    app.dependency_overrides[get_settings] = _settings
    try:
        client = TestClient(app)
        removal = {
            "kind": "ConfigMap",
            "name": "timesheets.old-page",
            "confirm": "timesheets.old-page",
        }
        path = "/api/v1/admin/apps/timesheets/residue/remove"
        refused = client.post(
            path, json=removal, headers={**_person, "Origin": "https://evil.example.com"}
        )
        assert refused.status_code == 403
        assert refused.json()["reason"] == "origin_mismatch"
        assert seen == {}
        own = client.post(path, json=removal, headers={**_person, "Origin": "http://testserver"})
        assert own.status_code == 202
        assert seen["url"] == f"{_base}/apps/timesheets/actions/remove-residue"
    finally:
        app.dependency_overrides.pop(get_settings, None)
