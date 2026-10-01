"""Behind the edge the desktop holds no authority of its own.

The Gateway ran the code flow with the zone's client and forwards the token;
what the caller may do on this tenant is the director's answer, relayed with
the caller's own token. This process reads no group, looks nothing up, and
decides no admin: it renders the verdict.
"""

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.routes import session
from app.core import auth
from app.core.config import Settings, get_settings
from app.core.gentian_groups import user_is_platform_admin, user_is_tenant_admin


def _settings(tenant: str = "platform", director_url: str | None = "http://director.test:8080") -> Settings:
    return Settings(
        AUTH_DISABLED="false",
        AUTH_MODE="edge",
        KERNEL_DOMAIN="desk.gentian.org",
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        GENTIAN_TENANT=tenant,
        DIRECTOR_URL=director_url,
    )


class FakeDirector:
    def __init__(self, relations, status=200):
        self.relations, self.status, self.seen = relations, status, {}

    def __call__(self, *a, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        self.seen["url"] = url
        self.seen["auth"] = (headers or {}).get("Authorization")
        return httpx.Response(
            self.status,
            json={"tenant": "platform", "subject": "root", "relations": self.relations},
            request=httpx.Request("GET", url),
        )


@pytest.mark.anyio
async def test_relations_come_from_the_director_with_the_callers_token(monkeypatch):
    director = FakeDirector({"can_enter": True, "can_administer": True})
    monkeypatch.setattr(auth.httpx, "AsyncClient", director)
    rel = await auth.fetch_tenant_relations("person-token", _settings())
    assert rel == {"can_enter": True, "can_administer": True}
    assert director.seen["url"] == "http://director.test:8080/v1/tenants/platform/me"
    assert director.seen["auth"] == "Bearer person-token"


@pytest.mark.anyio
async def test_a_director_that_refuses_or_is_absent_leaves_nothing(monkeypatch):
    monkeypatch.setattr(auth.httpx, "AsyncClient", FakeDirector({}, status=403))
    assert await auth.fetch_tenant_relations("t", _settings()) == {}
    assert await auth.fetch_tenant_relations("t", _settings(director_url=None)) == {}


def test_admin_flags_are_the_directors_verdict_not_a_group():
    admin = {"sub": "root", "tenant": "platform", "relations": {"can_administer": True}}
    member = {"sub": "mia", "tenant": "platform", "relations": {"can_administer": False}}
    tenant_admin = {"sub": "tom", "tenant": "acme", "relations": {"can_administer": True}}
    assert user_is_platform_admin(admin)
    assert user_is_tenant_admin(admin, "platform")
    assert not user_is_platform_admin(member)
    assert not user_is_tenant_admin(member)
    # A tenant's admin is not the platform's, whatever groups a token carried.
    assert user_is_tenant_admin(tenant_admin, "acme")
    assert not user_is_platform_admin(tenant_admin)
    # A group in the token does not promote anyone once the director has spoken.
    assert not user_is_platform_admin({"sub": "x", "tenant": "platform", "groups": ["gentian:platform:admin"], "relations": {}})


# The desktop administers nothing any more, so there is no cross-tenant
# selection left to assert. resolve_admin_tenant existed to let a platform
# administrator pick which tenant the bundled console acted on; the console is
# its own component now and does that itself, against the director
# (gentian-os S7A.6).


def test_me_renders_the_verdict_and_no_groups(monkeypatch):
    app = FastAPI()
    app.include_router(session.router, prefix="/api/v1")
    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "sub": "root", "preferred_username": "administrator", "email": "root@desk.gentian.org",
        "tenant": "platform", "relations": {"can_enter": True, "can_administer": True},
    }
    r = TestClient(app).get("/api/v1/session/me", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200
    body = r.json()
    assert body["isPlatformAdmin"] is True and body["isTenantAdmin"] is True
    assert body["groups"] == [] and body["shellApps"] == []
    assert body["relations"]["can_administer"] is True
