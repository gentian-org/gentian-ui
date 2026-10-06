"""The cluster's own catalogue screen: a relay, and nothing more.

What is worth pinning here is not the plumbing but the DIVISION. Which
editions are listed, which entries may be installed and which digest is
trustworthy are all the director's answers; this component must not have an
opinion about any of them, because a second opinion is a second answer to the
same question.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import catalogue
from app.core import director
from app.core.config import Settings, get_settings

# The relay forwards the CALLER's bearer, so every call carries one even
# where authentication is disabled: it is the token the director decides by.
_auth = {"Authorization": "Bearer t"}


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(catalogue.router, prefix="/api/v1")
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
        def __init__(self, *a, **kw):
            pass

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


def test_the_sources_screen_asks_the_director_and_carries_the_store(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {
            "tenant": "demo",
            "storeUrl": "https://store.gentian.org",
            "catalogues": [
                {"name": "main", "open": False},
                {"name": "in-house", "open": True},
            ],
        },
        seen,
    )
    client = TestClient(_app(_settings()))
    answer = client.get("/api/v1/catalogue/sources?tenant=demo", headers=_auth)
    assert answer.status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/tenants/demo/catalogues"
    # The store travels with the list, because "go to the App Store" is the
    # honest answer to most of this screen and it needs somewhere to point.
    assert answer.json()["storeUrl"] == "https://store.gentian.org"


def test_entries_are_relayed_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "tenant": "demo",
        "catalogue": "in-house",
        "open": True,
        "storeOnly": 7,
        "entries": [
            {
                "coordinate": "in-house/timesheets",
                "name": "timesheets",
                "version": "2.1.0",
                "edition": "pe",
                "digest": "sha256:" + "a" * 64,
                "installable": True,
            }
        ],
    }
    _fake_client(monkeypatch, body, seen)
    client = TestClient(_app(_settings()))
    answer = client.get("/api/v1/catalogue/sources/in-house/entries?tenant=demo", headers=_auth)
    assert answer.status_code == 200
    assert seen["url"] == ("http://director.test:8080/v1/tenants/demo/catalogues/in-house/entries")
    # Verbatim: which editions are listed and what may be installed are the
    # director's to decide, and re-deciding them here would be a second answer.
    assert answer.json() == body


def test_a_refusal_comes_back_as_the_director_gave_it(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "forbidden"}, seen, status=403)
    client = TestClient(_app(_settings()))
    assert client.get("/api/v1/catalogue/sources?tenant=other", headers=_auth).status_code == 403


def test_without_a_tenant_the_component_asks_about_its_own(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"catalogues": []}, seen)
    client = TestClient(_app(_settings()))
    assert client.get("/api/v1/catalogue/sources", headers=_auth).status_code == 200
    assert seen["url"].endswith("/v1/tenants/platform/catalogues")


# -- installing, uninstalling, granting ------------------------------------
#
# The person's token and nothing else decides these, so each test pins that
# the token arrives upstream, which path it arrives on, and that the body is
# exactly what the director's decoder accepts: it refuses unknown fields.

_person = {"Authorization": "Bearer person-token"}
_digest = "sha256:" + "a" * 64


def test_an_install_goes_to_the_director_as_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "installed", "commit": "a1b2c3d4"}, seen, status=202)
    client = TestClient(_app(_settings()))
    answer = client.post(
        "/api/v1/catalogue/apps/timesheets",
        json={"coordinate": "in-house/timesheets", "digest": _digest},
        headers=_person,
    )
    # 202 and the commit survive the relay: the screen tells "git has it"
    # from "it already held" by exactly these.
    assert answer.status_code == 202
    assert answer.json() == {"status": "installed", "commit": "a1b2c3d4"}
    assert seen["method"] == "POST"
    # The console's own tenant, the one the platform put it in.
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/apps/timesheets"
    assert seen["json"] == {"coordinate": "in-house/timesheets", "digest": _digest}
    assert seen["auth"] == "Bearer person-token"


def test_an_install_that_changed_nothing_is_still_the_directors_answer(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "already_installed"}, seen, status=200)
    client = TestClient(_app(_settings()))
    answer = client.post(
        "/api/v1/catalogue/apps/timesheets",
        json={"coordinate": "in-house/timesheets", "digest": _digest},
        headers=_person,
    )
    assert answer.status_code == 200
    assert answer.json() == {"status": "already_installed"}


def test_an_install_refused_comes_back_with_its_reason(monkeypatch):
    for status, message in (
        (400, "installing from a catalogue source needs the entry's digest: sha256:<hex>"),
        (403, "forbidden"),
        (
            502,
            "the catalogue source served a bundle that is not this entry; nothing was installed",
        ),
    ):
        seen: dict = {}
        body = {"error": message, "request_id": "r1"}
        _fake_client(monkeypatch, body, seen, status=status)
        client = TestClient(_app(_settings()))
        answer = client.post(
            "/api/v1/catalogue/apps/timesheets",
            json={"coordinate": "in-house/timesheets", "digest": _digest},
            headers=_person,
        )
        assert answer.status_code == status
        assert answer.json() == body


def test_a_missing_digest_is_the_directors_to_refuse(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "needs the entry's digest"}, seen, status=400)
    client = TestClient(_app(_settings()))
    answer = client.post(
        "/api/v1/catalogue/apps/timesheets",
        json={"coordinate": "in-house/timesheets"},
        headers=_person,
    )
    # Reached the director and came back as its 400, not as a 422 of this
    # component's own -- and without a null the decoder would also accept.
    assert answer.status_code == 400
    assert seen["json"] == {"coordinate": "in-house/timesheets"}


def test_an_uninstall_goes_to_the_director_as_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "uninstalled", "commit": "b2c3d4e5"}, seen, status=202)
    client = TestClient(_app(_settings()))
    answer = client.delete("/api/v1/catalogue/apps/timesheets", headers=_person)
    assert answer.status_code == 202
    assert answer.json() == {"status": "uninstalled", "commit": "b2c3d4e5"}
    assert seen["method"] == "DELETE"
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/apps/timesheets"
    assert seen["json"] is None
    assert seen["auth"] == "Bearer person-token"


def test_an_uninstall_refused_comes_back_as_the_director_gave_it(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "forbidden"}, seen, status=403)
    client = TestClient(_app(_settings()))
    answer = client.delete("/api/v1/catalogue/apps/timesheets", headers=_person)
    assert answer.status_code == 403
    assert answer.json() == {"error": "forbidden"}


def test_granting_an_app_to_everybody_goes_to_the_director_as_the_person(monkeypatch):
    seen: dict = {}
    body = {"status": "provisioned", "tenant": "platform", "profile": "timesheets"}
    _fake_client(monkeypatch, body, seen, status=202)
    client = TestClient(_app(_settings()))
    answer = client.post(
        "/api/v1/catalogue/actions/provision-app",
        json={"profile": "timesheets", "tenant": "somebody-elses"},
        headers=_person,
    )
    assert answer.status_code == 202
    assert answer.json() == body
    assert seen["method"] == "POST"
    assert seen["url"] == ("http://director.test:8080/v1/tenants/platform/actions/provision-app")
    # The profile and nothing beside it: the director's decoder refuses a
    # field it does not know.
    assert seen["json"] == {"profile": "timesheets"}
    assert seen["auth"] == "Bearer person-token"


def test_a_grant_refused_comes_back_with_its_reason(monkeypatch):
    # What the cluster answers between an install's commit and its sync.
    seen: dict = {}
    body = {"error": "timesheets is not installed in platform", "request_id": "r1"}
    _fake_client(monkeypatch, body, seen, status=400)
    client = TestClient(_app(_settings()))
    answer = client.post(
        "/api/v1/catalogue/actions/provision-app", json={"profile": "timesheets"}, headers=_person
    )
    assert answer.status_code == 400
    assert answer.json() == body


def test_none_of_them_is_relayed_without_a_token(monkeypatch):
    # Authentication is off in this suite (conftest), and the relay still
    # refuses: there is no token to decide by, so nothing reaches the
    # director at all.
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "installed"}, seen, status=202)
    client = TestClient(_app(_settings()))
    assert client.post("/api/v1/catalogue/apps/timesheets", json={}).status_code == 401
    assert client.delete("/api/v1/catalogue/apps/timesheets").status_code == 401
    assert (
        client.post("/api/v1/catalogue/actions/provision-app", json={"profile": "x"}).status_code
        == 401
    )
    assert seen == {}
