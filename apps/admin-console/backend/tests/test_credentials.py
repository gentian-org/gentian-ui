"""Credentials are relayed to the custodian, as the caller.

The custodian exchanges the person's own token for one OpenBao will
accept, so what may be stored is decided by their identity rather than by a
service acting for them. This console holds neither token.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import credentials
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(credentials.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings(**over) -> Settings:
    base = {
        "AUTH_DISABLED": "true",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "TENANT_ID": "platform",
        "DIRECTOR_URL": "http://director.test:8080",
        "GENTIAN_CLUSTER_ID": "demo",
        "CUSTODIAN_URL": "http://credentials.test:9444",
    }
    base.update(over)
    return Settings(**base)


def _fake_client(monkeypatch, seen: dict, status: int = 200, body: dict | None = None):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"], seen["json"] = method, url, json
            seen["params"] = params
            seen["auth"] = (headers or {}).get("Authorization")
            return httpx.Response(
                status, json=body or {"credentials": []}, request=httpx.Request(method, url)
            )

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_the_screens_paths_reach_the_services_own(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen)
    client = TestClient(_app(_settings()))

    for called, expected in (
        ("/api/v1/credentials", "/v1/credentials"),
        ("/api/v1/credentials/backup-identity", "/v1/backup-identity"),
        ("/api/v1/credentials/repositories/list", "/v1/repositories"),
    ):
        r = client.get(called, headers={"Authorization": "Bearer person"})
        assert r.status_code == 200, called
        assert seen["url"] == f"http://credentials.test:9444{expected}"
        # The caller's own bearer, which is the whole point.
        assert seen["auth"] == "Bearer person"


def test_a_write_carries_the_body_and_the_name(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen, body={"stored": True})
    r = TestClient(_app(_settings())).put(
        "/api/v1/credentials/backup-destination",
        json={"accessKey": "a", "secretKey": "b"},
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 200
    assert seen["method"] == "PUT"
    assert seen["url"] == "http://credentials.test:9444/v1/credentials/backup-destination"
    assert seen["json"] == {"accessKey": "a", "secretKey": "b"}


def test_a_path_this_console_does_not_serve_is_not_forwarded(monkeypatch):
    """A prefix rewrite would send anything at all to the credential
    manager. The map means an unknown path stops here."""
    seen: dict = {}
    _fake_client(monkeypatch, seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/credentials/nonsense/deep", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 404
    assert not seen


@pytest.mark.parametrize("status", [403, 409, 502])
def test_the_refusal_is_passed_through_unchanged(monkeypatch, status):
    _fake_client(monkeypatch, {}, status=status, body={"detail": "refused"})
    r = TestClient(_app(_settings())).get(
        "/api/v1/credentials", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == status


def test_without_a_custodian_it_says_so(monkeypatch):
    """Rather than guessing at a host: a component that has not been told
    where something is has not been told."""
    r = TestClient(_app(_settings(CUSTODIAN_URL=None))).get(
        "/api/v1/credentials", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 503
    assert "custodian is not configured" in r.json()["detail"]


def test_no_token_is_refused_before_anything_is_forwarded():
    assert TestClient(_app(_settings())).get("/api/v1/credentials").status_code == 401


def test_declaring_a_repository_is_a_commit_at_the_director(monkeypatch):
    """Where software comes from is configuration, so the director commits it
    and the custodian has no route for it. Only what a declaration may say
    travels: the director refuses a body with any other field."""
    seen: dict = {}
    answer = {"status": "created", "name": "mine", "credentialName": "repository-mine"}
    _fake_client(monkeypatch, seen, status=202, body=answer)
    r = TestClient(_app(_settings())).put(
        "/api/v1/credentials/repositories/mine",
        json={
            "role": "apps",
            "type": "git",
            "url": "https://git.example/acme/apps",
            "branch": "",
            "writable": False,
            "tenant": "other",
            "credential": {"vaultPath": "elsewhere"},
            "password": "s3cret",
        },
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 202
    assert r.json()["credentialName"] == "repository-mine"
    assert seen["method"] == "PUT"
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/repositories/mine"
    assert seen["json"] == {
        "role": "apps",
        "type": "git",
        "url": "https://git.example/acme/apps",
        "writable": False,
    }
    assert seen["auth"] == "Bearer person"


def test_the_clusters_own_repository_is_asked_of_the_cluster(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen, status=202, body={"status": "updated"})
    client = TestClient(_app(_settings()))
    r = client.put(
        "/api/v1/credentials/repositories/base?scope=cluster",
        json={"role": "apps", "type": "oci", "url": "oci://r.example/apps", "confirm": "base"},
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 202
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/repositories/base"
    assert seen["json"]["confirm"] == "base"

    r = client.delete(
        "/api/v1/credentials/repositories/theirs?tenant=acme&confirm=theirs",
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 202
    assert seen["method"] == "DELETE"
    assert seen["url"] == "http://director.test:8080/v1/tenants/acme/repositories/theirs"
    assert seen["params"] == {"confirm": "theirs"}


def test_a_change_that_wants_the_name_retyped_reaches_the_danger_zone(monkeypatch):
    """428 and its fields are the director's answer and arrive unchanged: the
    screen reads confirmWith from it rather than deciding what is dangerous."""
    seen: dict = {}
    wanted = {
        "error": "removing it stops every app it provides from reconciling",
        "confirmField": "confirm",
        "confirmWith": "mine",
        "dangerous": True,
        "requiresRetype": True,
    }
    _fake_client(monkeypatch, seen, status=428, body=wanted)
    r = TestClient(_app(_settings())).delete(
        "/api/v1/credentials/repositories/mine", headers={"Authorization": "Bearer person"}
    )
    assert r.status_code == 428
    assert r.json() == wanted
    assert seen["url"] == "http://director.test:8080/v1/tenants/platform/repositories/mine"
    assert seen["params"] is None


def test_a_name_that_is_not_one_is_not_put_in_a_path(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen)
    r = TestClient(_app(_settings())).put(
        "/api/v1/credentials/repositories/Not_A_Name",
        json={"role": "apps", "type": "git", "url": "https://x"},
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 400
    assert not seen


def test_a_repositorys_password_is_a_credential_at_the_custodian(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen, body={"stored": True})
    r = TestClient(_app(_settings())).put(
        "/api/v1/credentials/repository-mine",
        json={"fields": {"password": "s3cret"}},
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 200
    assert seen["url"] == "http://credentials.test:9444/v1/credentials/repository-mine"


def test_declaring_needs_no_custodian_and_never_falls_back_to_it(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, seen)
    r = TestClient(_app(_settings(DIRECTOR_URL=None))).put(
        "/api/v1/credentials/repositories/mine",
        json={"role": "apps", "type": "git", "url": "https://x"},
        headers={"Authorization": "Bearer person"},
    )
    assert r.status_code == 503
    assert "director is not configured" in r.json()["detail"]
    assert not seen
