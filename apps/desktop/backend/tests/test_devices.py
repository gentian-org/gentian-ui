"""The desktop hands a person's own device passwords on, and decides nothing.

The usher says which ways the person may make a password for, the registrar
makes, lists and revokes them. What matters here is that the caller's own
token reaches them unchanged, that the tenant asked about is this desktop's
own, and that every answer -- a refusal and the registrar's step-up
challenge included -- comes back as it was given.
"""


import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import devices
from app.core.config import Settings, get_settings


def _settings(**over) -> Settings:
    values = {
        "AUTH_DISABLED": "true",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "USHER_URL": "http://usher.test:8080/",
        "REGISTRAR_URL": "http://registrar.test:9445",
        "GENTIAN_TENANT": "acme",
    }
    values.update(over)
    return Settings(**{k: v for k, v in values.items() if v is not None})


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(devices.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def _fake(monkeypatch, respond):
    seen = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, headers=None, json=None):
            seen.append(
                {
                    "method": method,
                    "url": url,
                    "auth": (headers or {}).get("Authorization"),
                    "body": json,
                }
            )
            return respond(method, url)

    monkeypatch.setattr(devices.httpx, "AsyncClient", FakeClient)
    return seen


AUTH = {"Authorization": "Bearer person-token"}


def test_the_door_and_the_list_are_asked_with_the_callers_token(monkeypatch):
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(200, json={"ways": []}))
    client = _client(_settings())
    assert client.get("/api/v1/account/devices/door", headers=AUTH).status_code == 200
    assert client.get("/api/v1/account/devices", headers=AUTH).status_code == 200
    assert [s["url"] for s in seen] == [
        "http://usher.test:8080/v1/tenants/acme/door",
        "http://registrar.test:9445/v1/tenants/acme/device-passwords",
    ]
    assert all(s["auth"] == "Bearer person-token" for s in seen)


def test_making_one_is_not_stored_and_names_nobody_else(monkeypatch):
    made = {
        "id": "dp1",
        "name": "Phone",
        "ways": ["calendars"],
        "username": "ana",
        "password": "k3m9x-p2hrt-aaaaa-bbbbb-ccccc",
    }
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(201, json=made))
    client = _client(_settings())
    answer = client.post(
        "/api/v1/account/devices",
        headers=AUTH,
        json={"name": "Phone", "ways": ["calendars"], "person": "tom"},
    )
    assert answer.status_code == 201
    assert answer.headers["cache-control"] == "no-store"
    assert answer.json()["password"] == made["password"]
    assert (
        seen[0]["url"]
        == "http://registrar.test:9445/v1/tenants/acme/actions/create-device-password"
    )
    assert seen[0]["body"] == {"name": "Phone", "ways": ["calendars"]}


def test_the_step_up_challenge_comes_back_as_it_was_given(monkeypatch):
    challenge = 'Bearer error="insufficient_user_authentication", max_age=600'
    _fake(
        monkeypatch,
        lambda m, u: httpx.Response(
            401, json={"error": "sign in again"}, headers={"WWW-Authenticate": challenge}
        ),
    )
    answer = _client(_settings()).post(
        "/api/v1/account/devices", headers=AUTH, json={"name": "Phone", "ways": ["files"]}
    )
    assert answer.status_code == 401
    assert answer.headers["www-authenticate"] == challenge


def test_revoking_one_names_it_in_the_body(monkeypatch):
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(204))
    answer = _client(_settings()).delete("/api/v1/account/devices/dp1", headers=AUTH)
    assert answer.status_code == 204
    assert seen[0]["method"] == "POST" and seen[0]["body"] == {"id": "dp1"}
    assert seen[0]["url"].endswith("/v1/tenants/acme/actions/revoke-device-password")


def test_nothing_is_asked_without_a_registrar(monkeypatch):
    seen = _fake(monkeypatch, lambda m, u: httpx.Response(200, json={}))
    answer = _client(_settings(REGISTRAR_URL=None)).get("/api/v1/account/devices", headers=AUTH)
    assert answer.status_code == 503 and seen == []
