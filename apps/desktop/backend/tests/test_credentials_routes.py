"""The literal credential routes must not be shadowed by the catch-all.

`/credentials/{name}` matches anything, "backup-identity" included. FastAPI
resolves in registration order, so with the catch-all declared first every
backup-identity call went to the credential-requirement handler, which
forwarded it to /v1/credentials/backup-identity and got a 404 — an endpoint
that looked missing rather than shadowed, on a page that had just shipped.

Registration order is the thing under test, so this reads the router directly
rather than the app: the routes are mounted into a sub-application and their
paths are not visible from app.routes at all.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import credentials
from app.api.routes.credentials import router
from app.core.config import Settings, get_settings


def _first_index(method: str, path: str) -> int:
    for i, route in enumerate(router.routes):
        if method in (getattr(route, "methods", None) or set()) and route.path == path:
            return i
    raise AssertionError(f"{method} {path} is not registered at all")


def test_backup_identity_is_declared_before_the_name_catch_all():
    catch_all = _first_index("PUT", "/credentials/{name}")
    for method in ("GET", "PUT"):
        literal = _first_index(method, "/credentials/backup-identity")
        assert literal < catch_all, (
            f"{method} /backup-identity is registered after PUT /{{name}}, "
            "which matches it first and forwards it as a credential name"
        )


def test_the_catch_all_still_exists_for_real_credentials():
    """Moving the literal routes up must not strand ordinary credentials."""
    assert _first_index("PUT", "/credentials/{name}") >= 0


def _client(monkeypatch, seen: list, status: int, body: dict, **over) -> TestClient:
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen.append({"method": method, "url": url, "params": params, "json": json})
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(credentials.httpx, "AsyncClient", FakeClient)
    env = {
        "AUTH_DISABLED": "true",
        "DIRECTOR_URL": "http://director.test:8080",
        "CUSTODIAN_URL": "http://custodian.test:9444",
        "GENTIAN_TENANT": "acme",
    }
    env.update(over)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: Settings(**env)
    return TestClient(app)


AUTH = {"Authorization": "Bearer person-token"}


def test_declaring_a_repository_is_asked_of_the_director(monkeypatch):
    """The custodian no longer declares one. Only what a declaration may say
    travels, because the director refuses a body with any other field."""
    seen: list = []
    client = _client(monkeypatch, seen, 202, {"credentialName": "repository-mine"})
    r = client.put(
        "/api/v1/credentials/repositories/mine",
        json={"role": "apps", "type": "git", "url": "https://x", "tenant": "other", "password": "p"},
        headers=AUTH,
    )
    assert r.status_code == 202
    assert seen[0]["url"] == "http://director.test:8080/v1/tenants/acme/repositories/mine"
    assert seen[0]["json"] == {"role": "apps", "type": "git", "url": "https://x"}


def test_removing_one_carries_the_confirmation_and_its_refusal_back(monkeypatch):
    seen: list = []
    wanted = {"error": "why", "confirmField": "confirm", "confirmWith": "mine"}
    client = _client(monkeypatch, seen, 428, wanted)
    r = client.delete("/api/v1/credentials/repositories/mine?confirm=mine", headers=AUTH)
    assert r.status_code == 428
    assert r.json() == wanted
    assert seen[0]["method"] == "DELETE"
    assert seen[0]["url"] == "http://director.test:8080/v1/tenants/acme/repositories/mine"
    assert seen[0]["params"] == {"confirm": "mine"}


def test_without_a_director_declaring_says_so_and_asks_nobody(monkeypatch):
    seen: list = []
    client = _client(monkeypatch, seen, 200, {}, DIRECTOR_URL=None)
    r = client.put(
        "/api/v1/credentials/repositories/mine",
        json={"role": "apps", "type": "git", "url": "https://x"},
        headers=AUTH,
    )
    assert r.status_code == 503
    assert "DIRECTOR_URL" in r.json()["detail"]
    assert not seen


def test_the_list_of_repositories_is_still_the_custodians(monkeypatch):
    seen: list = []
    client = _client(monkeypatch, seen, 200, {"repositories": []})
    r = client.get("/api/v1/credentials/repositories/list", headers=AUTH)
    assert r.status_code == 200
    assert seen[0]["url"] == "http://custodian.test:9444/v1/repositories"
