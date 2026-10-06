"""People, groups and the realm's password policy, relayed to the registrar.

What these assert is the relay's shape rather than Keycloak's behaviour: the
registrar is the one that holds a credential and decides, and a test here that
pretended otherwise would be testing a second implementation of a decision
that has one home.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import admin, people
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(people.router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings(**over) -> Settings:
    base = {
        "AUTH_DISABLED": "true",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "TENANT_ID": "platform",
        "DIRECTOR_URL": "http://director.test:8080",
        "REGISTRAR_URL": "http://registrar.test:8080",
        "GENTIAN_CLUSTER_ID": "demo",
    }
    base.update(over)
    return Settings(**base)


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
            seen["params"], seen["json"] = params, json
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_people_are_asked_of_the_tenant(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {
            "tenant": "platform",
            "people": [{"id": "u1", "username": "ada@example.com", "pending": True}],
        },
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/people", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://registrar.test:8080/v1/tenants/platform/people"
    # pending survives the relay: somebody invited who has not finished is not
    # the same as somebody who can sign in, and a list that flattened the two
    # would make a failed invitation invisible.
    assert r.json()["people"][0]["pending"] is True


def test_a_search_is_passed_through(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"people": []}, seen)
    TestClient(_app(_settings())).get(
        "/api/v1/admin/people?search=ada&limit=10", headers={"Authorization": "Bearer t"}
    )
    assert seen["params"] == {"search": "ada", "limit": "10"}


def test_inviting_is_an_action_not_a_commit(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {"person": {"id": "new", "email": "ada@example.com", "pending": True}, "mailed": True},
        seen,
        status=202,
    )
    r = TestClient(_app(_settings())).post(
        "/api/v1/admin/people/invite",
        json={"email": "ada@example.com", "groups": ["gentian:tenant:platform:members"]},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 202
    assert seen["method"] == "POST"
    # /actions/ is the registrar's way of saying this happens once and leaves
    # no commit. A PUT here would be declaring a person as state.
    assert seen["url"] == "http://registrar.test:8080/v1/tenants/platform/actions/invite-person"
    assert seen["json"] == {
        "email": "ada@example.com",
        "groups": ["gentian:tenant:platform:members"],
    }


def test_an_invitation_whose_mail_failed_still_reports_the_person(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {
            "person": {"id": "new", "email": "ada@example.com"},
            "mailed": False,
            "warning": "smtp down",
        },
        seen,
        status=202,
    )
    r = TestClient(_app(_settings())).post(
        "/api/v1/admin/people/invite",
        json={"email": "ada@example.com"},
        headers={"Authorization": "Bearer t"},
    )
    # The repair is to re-send, not to invite again, so the screen has to be
    # able to tell the two apart.
    assert r.json()["mailed"] is False
    assert r.json()["person"]["id"] == "new"


def test_membership_says_which_way(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"member": False}, seen)
    TestClient(_app(_settings())).post(
        "/api/v1/admin/people/membership",
        json={"person": "u1", "group": "gentian:tenant:platform:members", "member": False},
        headers={"Authorization": "Bearer t"},
    )
    assert seen["url"] == "http://registrar.test:8080/v1/tenants/platform/actions/set-membership"
    assert seen["json"]["member"] is False


def test_the_password_policy_is_read_and_written(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"realm": "platform", "passwordPolicy": "length(8)"}, seen)
    client = TestClient(_app(_settings()))

    r = client.get("/api/v1/admin/identity", headers={"Authorization": "Bearer t"})
    assert r.json()["passwordPolicy"] == "length(8)"
    assert seen["url"] == "http://registrar.test:8080/v1/tenants/platform/identity"

    client.post(
        "/api/v1/admin/identity/password-policy",
        json={"passwordPolicy": "length(12)"},
        headers={"Authorization": "Bearer t"},
    )
    assert (
        seen["url"] == "http://registrar.test:8080/v1/tenants/platform/actions/set-password-policy"
    )
    assert seen["json"] == {"passwordPolicy": "length(12)"}


def test_groups_are_served_rather_than_refused(monkeypatch):
    """They used to answer 501 for the Notifications screen.

    The entry said a group-scoped audience waited for the group list to have
    an owner. It has one now, so the entry is gone and this route answers.
    """
    seen: dict = {}
    _fake_client(monkeypatch, {"groups": [{"path": "gentian:tenant:platform:admins"}]}, seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/groups", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert seen["url"] == "http://registrar.test:8080/v1/tenants/platform/groups"


def test_a_realm_with_no_credential_is_relayed_as_the_platforms_problem(monkeypatch):
    """503, not 403.

    The caller holds the relation; what is missing is the credential the
    operator writes per realm. Telling them they are forbidden would send
    them to ask for a permission they already have.
    """
    seen: dict = {}
    _fake_client(
        monkeypatch,
        {"error": "this registrar holds no credential for that realm"},
        seen,
        status=503,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/admin/people?tenant=demo", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 503
    assert "no credential" in r.json()["error"]


def test_an_invitation_relays_the_whole_form(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"mailed": True}, seen, status=202)
    client = TestClient(_app(_settings()))
    res = client.post(
        "/api/v1/admin/people/invite",
        json={
            "email": "jane@example.org",
            "username": "jane-doe",
            "firstName": "Jane",
            "lastName": "Doe",
            "requireTotp": True,
            "settingsTemplate": "t1",
            "groups": ["g"],
            "smuggled": "nope",
        },
        headers={"Authorization": "Bearer t"},
    )
    assert res.status_code == 202
    assert seen["url"].endswith("/v1/tenants/platform/actions/invite-person")
    assert seen["json"] == {
        "email": "jane@example.org",
        "username": "jane-doe",
        "firstName": "Jane",
        "lastName": "Doe",
        "requireTotp": True,
        "settingsTemplate": "t1",
        "groups": ["g"],
    }


def test_an_edit_relays_only_what_it_names(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"id": "u1"}, seen)
    client = TestClient(_app(_settings()))
    res = client.post(
        "/api/v1/admin/people/update",
        json={"person": "u1", "enabled": False},
        headers={"Authorization": "Bearer t"},
    )
    assert res.status_code == 200
    assert seen["url"].endswith("/actions/update-person")
    assert seen["json"] == {"person": "u1", "enabled": False}


def test_member_actions_reach_their_registrar_actions(monkeypatch):
    client = TestClient(_app(_settings()))
    for path, action, body in [
        ("/api/v1/admin/people/remove", "remove-person", {"person": "u1"}),
        ("/api/v1/admin/people/reset-password", "send-password-reset", {"person": "u1"}),
        ("/api/v1/admin/people/require-totp", "require-totp", {"person": "u1", "mail": True}),
        ("/api/v1/admin/people/remove-totp", "remove-totp", {"person": "u1"}),
        ("/api/v1/admin/groups/create", "create-group", {"name": "sales"}),
        ("/api/v1/admin/groups/delete", "delete-group", {"group": "gentian:tenant:x:sales"}),
        (
            "/api/v1/admin/groups/rename",
            "rename-group",
            {"group": "gentian:tenant:x:sales", "name": "field"},
        ),
    ]:
        seen: dict = {}
        _fake_client(monkeypatch, {}, seen)
        assert (
            client.post(path, json=body, headers={"Authorization": "Bearer t"}).status_code == 200
        ), path
        assert seen["url"] == f"http://registrar.test:8080/v1/tenants/platform/actions/{action}", (
            path,
            seen["url"],
        )
        assert seen["json"] == body


def test_one_person_a_groups_members_and_the_templates_are_the_registrars(monkeypatch):
    client = TestClient(_app(_settings()))
    for path, upstream, params in [
        ("/api/v1/admin/people/u1", "people/u1", None),
        ("/api/v1/admin/groups/members?group=g", "group-members", {"group": "g"}),
        ("/api/v1/admin/templates", "templates", None),
    ]:
        seen: dict = {}
        _fake_client(monkeypatch, {}, seen)
        assert client.get(path, headers={"Authorization": "Bearer t"}).status_code == 200, path
        assert seen["url"] == f"http://registrar.test:8080/v1/tenants/platform/{upstream}"
        assert seen["params"] == params


def test_without_a_registrar_it_says_so_and_asks_nobody(monkeypatch):
    """503 naming the setting, on a read and on a write alike.

    The director is configured here and is not asked instead: it answers 404
    on every one of these, and a console that fell back to it would show an
    unconfigured registrar as a tenant with nobody in it.
    """
    seen: dict = {}
    _fake_client(monkeypatch, {}, seen)
    client = TestClient(_app(_settings(REGISTRAR_URL=None)))
    for r in (
        client.get("/api/v1/admin/people", headers={"Authorization": "Bearer t"}),
        client.get("/api/v1/admin/groups", headers={"Authorization": "Bearer t"}),
        client.post(
            "/api/v1/admin/people/remove",
            json={"person": "u1"},
            headers={"Authorization": "Bearer t"},
        ),
    ):
        assert r.status_code == 503
        assert "registrar is not configured" in r.json()["detail"]
        assert "REGISTRAR_URL" in r.json()["detail"]
    assert seen == {}


def test_a_refused_change_to_a_platform_administrator_arrives_as_it_was_said(monkeypatch):
    """403 with the registrar's own sentence, under the key it used.

    The screen prints `error` beside the status; replacing it here with this
    API's wording would lose the one line that says why.
    """
    seen: dict = {}
    said = (
        "refused: ada is a platform administrator. "
        "Who administers the platform is not changed through the registrar."
    )
    _fake_client(monkeypatch, {"error": said, "request_id": "r1"}, seen, status=403)
    r = TestClient(_app(_settings())).post(
        "/api/v1/admin/people/remove",
        json={"person": "u1"},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 403
    assert r.json()["error"] == said
