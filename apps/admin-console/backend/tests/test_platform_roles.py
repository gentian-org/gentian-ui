"""The security officers and the tenant's switch for the platform's
administrators: every route relays as the caller, to the director for what
is declared in git and to the registrar for who could be chosen."""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster, security
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(cluster.router, prefix="/api/v1")
    app.include_router(security.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        REGISTRAR_URL="http://registrar.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )


def _fake_client(monkeypatch, status, body, seen: dict):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"], seen["json"] = method, url, json
            seen["auth"] = (headers or {}).get("Authorization")
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def test_the_holders_are_read_from_the_director(monkeypatch):
    seen: dict = {}
    holders = {
        "cluster": "demo",
        "securityOfficers": [
            {
                "tenant": "acme",
                "subject": "7d0f",
                "username": "it@acme.example",
                "signIn": "https://platform.desk.gentian.org/?kc_idp_hint=tenant-acme",
            }
        ],
    }
    _fake_client(monkeypatch, 200, holders, seen)
    r = TestClient(_app(_settings())).get(
        "/api/v1/cluster/security-officers", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200
    assert r.json()["securityOfficers"][0]["signIn"].endswith("kc_idp_hint=tenant-acme")
    assert (
        seen["url"] == "http://director.test:8080/v1/clusters/demo/platform-roles/security-officers"
    )
    assert seen["auth"] == "Bearer t"


def test_naming_one_is_a_commit_by_the_subject(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, 202, {"status": "updated", "commit": "a1b2c3d4"}, seen)
    r = TestClient(_app(_settings())).put(
        "/api/v1/cluster/security-officers/acme/7d0f",
        json={"username": "it@acme.example", "email": "it@acme.example"},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 202 and r.json()["commit"] == "a1b2c3d4"
    assert seen["method"] == "PUT"
    assert seen["url"] == (
        "http://director.test:8080/v1/clusters/demo/platform-roles/security-officers/acme/7d0f"
    )
    assert seen["json"] == {"username": "it@acme.example", "email": "it@acme.example"}


def test_a_refusal_comes_back_as_it_was(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, 403, {"error": "can_configure on cluster:demo refused"}, seen)
    r = TestClient(_app(_settings())).delete(
        "/api/v1/cluster/security-officers/acme/7d0f", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 403
    assert seen["method"] == "DELETE"


def test_who_could_be_chosen_is_the_registrars_answer(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        200,
        {
            "cluster": "demo",
            "complete": True,
            "tenants": [{"tenant": "acme", "administrators": []}],
        },
        seen,
    )
    r = TestClient(_app(_settings())).get(
        "/api/v1/cluster/tenant-administrators", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200 and r.json()["complete"] is True
    assert seen["url"] == "http://registrar.test:8080/v1/clusters/demo/tenant-administrators"


def test_the_tenants_switch_is_read_and_written_as_declared_state(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, 200, {"tenant": "acme", "adminsEnter": False}, seen)
    client = TestClient(_app(_settings()))
    r = client.get(
        "/api/v1/admin/platform-access?tenant=acme", headers={"Authorization": "Bearer t"}
    )
    assert r.status_code == 200 and r.json()["adminsEnter"] is False
    assert seen["url"] == "http://director.test:8080/v1/tenants/acme/platform-access"

    _fake_client(monkeypatch, 202, {"status": "updated", "commit": "a1b2c3d4"}, seen)
    r = client.put(
        "/api/v1/admin/platform-access?tenant=acme",
        json={"adminsEnter": True, "something": "else"},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 202
    # Only the switch travels, as a boolean, whatever else the body carried.
    assert seen["json"] == {"adminsEnter": True}
    assert seen["method"] == "PUT"
