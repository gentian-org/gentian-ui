"""The contract `notices`: who may publish, what is taken, and who then sees it.

What is checked: the route answers only to the contract's credential (503
while there is none, 401 without it or with anything else, a person's token
included, and before the body is looked at), which bodies it takes, that a
group outside this desktop's tenant is refused, and that a notice for named
people reaches those people's inboxes and nobody else's.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import notices
from app.core.config import Settings, get_settings
from app.services.sql_notification_store import SqlNotificationStore

TENANT = "acme"
KEY = "s3cr3t-contract-key"
URL = "/api/v1/notices"

ADA = {
    "sub": "8f1c",
    "preferred_username": "ada",
    "email": "ada@example.org",
    "groups": [f"gentian:tenant:{TENANT}:members"],
}
GRACE = {
    "sub": "77aa",
    "preferred_username": "grace",
    "email": "grace@example.org",
    "groups": [f"gentian:tenant:{TENANT}:members"],
}


def _settings(**over) -> Settings:
    # Passed by alias: the environment conftest sets wins over field names.
    values = {
        "AUTH_DISABLED": "false",
        "OIDC_ISSUER": "https://id.desk.gentian.org/auth/realms/acme",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "GENTIAN_TENANT": TENANT,
        "NOTICES_KEY": KEY,
    }
    values.update(over)
    return Settings(**values)


def _client(**over) -> TestClient:
    app = FastAPI()
    app.include_router(notices.router, prefix="/api/v1")
    settings = _settings(**over)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def _auth(key: str = KEY) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def _body(**over) -> dict:
    body = {
        "title": "Your export is ready",
        "body": "Fetch it within a week.",
        "publisher": "Exports",
        "people": ["ada@example.org"],
    }
    body.update(over)
    return body


def test_the_app_serves_the_route_at_its_path():
    # The application itself, as the test environment configures it: no key,
    # so the route is there and says that nobody was granted the contract.
    from app.main import app

    response = TestClient(app).post(URL, json=_body(), headers=_auth())
    assert response.status_code == 503
    assert "/api/v1/notices" in app.openapi()["paths"]


def test_no_key_set_answers_503():
    client = _client(NOTICES_KEY="")
    for headers in ({}, _auth(), _auth("")):
        response = client.post(URL, json=_body(), headers=headers)
        assert response.status_code == 503
        assert response.json()["detail"] == "no component has been granted the contract"


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": ""},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "Bearer wrong"},
        {"Authorization": f"Bearer {KEY}x"},
        {"Authorization": f"Basic {KEY}"},
        {"Authorization": KEY},
        # What a person's session sends: a token of the realm.
        {"Authorization": "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI4ZjFjIn0.c2ln"},
    ],
)
def test_without_the_credential_answers_401(headers):
    response = _client().post(URL, json=_body(), headers=headers)
    assert response.status_code == 401


def test_the_credential_is_asked_before_the_body():
    client = _client()
    assert client.post(URL, json={"nonsense": True}).status_code == 401
    assert client.post(URL, content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 401
    assert client.post(URL, json={"nonsense": True}, headers=_auth()).status_code == 422


def test_auth_disabled_does_not_open_the_route():
    # The development switch stands in for a person; it is not the credential.
    client = _client(AUTH_DISABLED="true", ENVIRONMENT="local", NOTICES_KEY="")
    assert client.post(URL, json=_body()).status_code == 503
    client = _client(AUTH_DISABLED="true", ENVIRONMENT="local")
    assert client.post(URL, json=_body()).status_code == 401


async def test_notice_for_a_person_reaches_that_inbox_only():
    response = _client().post(URL, json=_body(), headers=_auth())
    assert response.status_code == 201
    notice_id = response.json()["id"]
    assert response.json() == {"id": notice_id}

    store = SqlNotificationStore()
    inbox = await store.list_inbox(ADA, user_tenant=TENANT)
    assert [n.id for n in inbox] == [notice_id]
    stored = inbox[0]
    assert stored.title == "Your export is ready"
    assert stored.publisher == "Exports"
    assert stored.severity == "info"
    assert stored.tenant == TENANT
    assert stored.audience.scope == "tenant"
    assert stored.audience.tenant == TENANT
    assert stored.audience.people == ["ada@example.org"]
    assert stored.audience.groups == []
    # Every member is not who it was for.
    assert await store.list_inbox(GRACE, user_tenant=TENANT) == []


async def test_notice_for_a_group_and_a_person():
    body = _body(
        people=["grace"],
        groups=[f"gentian:tenant:{TENANT}:admins"],
        severity="warning",
        linkUrl="https://files.example.org/export/1",
        linkLabel="Open",
    )
    response = _client().post(URL, json=body, headers=_auth())
    assert response.status_code == 201

    store = SqlNotificationStore()
    admin = {"sub": "a1", "groups": [f"gentian:tenant:{TENANT}:admins"]}
    assert len(await store.list_inbox(admin, user_tenant=TENANT)) == 1
    (seen,) = await store.list_inbox(GRACE, user_tenant=TENANT)
    assert seen.link_url == "https://files.example.org/export/1"
    assert seen.link_label == "Open"
    assert seen.severity == "warning"
    assert await store.list_inbox(ADA, user_tenant=TENANT) == []


@pytest.mark.parametrize(
    "over",
    [
        {"people": [], "groups": []},
        {"people": []},
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"body": ""},
        {"body": "x" * 4001},
        {"severity": "urgent"},
        {"publisher": ""},
        {"publisher": "x" * 201},
        {"people": ["x"] * 51},
        {"people": [""]},
        {"people": ["x" * 321]},
        {"groups": [f"gentian:tenant:{TENANT}:g{i}" for i in range(21)]},
        {"linkUrl": "http://example.org/"},
        {"linkUrl": "javascript:alert(1)"},
        {"linkUrl": "https://"},
        {"linkLabel": "x" * 101},
        {"expiresAt": 1},
        {"tenant": "other"},
        {"scope": "platform"},
    ],
)
def test_refused_bodies(over):
    response = _client().post(URL, json=_body(**over), headers=_auth())
    assert response.status_code == 422, response.text


def test_missing_title_or_publisher_is_refused():
    for field in ("title", "body", "publisher"):
        body = _body()
        del body[field]
        assert _client().post(URL, json=body, headers=_auth()).status_code == 422


@pytest.mark.parametrize(
    "group",
    [
        "gentian:tenant:other:members",
        "gentian:platform:admin",
        "members",
        f"gentian:tenant:{TENANT}x:members",
    ],
)
async def test_group_outside_this_tenant_is_refused(group):
    response = _client().post(URL, json=_body(groups=[group]), headers=_auth())
    assert response.status_code == 422
    assert await SqlNotificationStore().list_for_tenant(TENANT) == []


def test_limits_are_inclusive():
    body = _body(
        title="x" * 200,
        body="x" * 4000,
        publisher="x" * 200,
        people=["x" * 320] * 50,
        groups=[f"gentian:tenant:{TENANT}:g{i}" for i in range(20)],
        linkLabel="x" * 100,
    )
    assert _client().post(URL, json=body, headers=_auth()).status_code == 201


def test_no_tenant_stated_answers_503():
    response = _client(GENTIAN_TENANT="").post(URL, json=_body(), headers=_auth())
    assert response.status_code == 503
