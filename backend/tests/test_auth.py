"""Tests for OIDC settings and token client validation."""

import jwt
import pytest

from app.api.routes.auth import session_started
from app.core.auth import _issuer_allowed, _validate_client_id
from app.core.config import Settings


def test_oidc_realm_base_url_prefers_internal_keycloak():
    settings = Settings(
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
    )
    assert (
        settings.oidc_realm_base_url
        == "http://keycloak.platform-kernel.svc:8080/auth/realms/kernel"
    )
    assert (
        settings.oidc_jwks_url
        == "http://keycloak.platform-kernel.svc:8080/auth/realms/kernel/protocol/openid-connect/certs"
    )


def test_validate_client_id_accepts_azp():
    claims = {"azp": "gentian-portal"}
    settings = Settings()
    settings.oidc_client_id = "gentian-portal"
    settings.portal_bff_client_id = "gentian-portal-bff"
    _validate_client_id(claims, settings)


def test_validate_client_id_accepts_audience_list():
    claims = {"aud": ["account", "gentian-portal"]}
    settings = Settings()
    settings.oidc_client_id = "gentian-portal"
    settings.portal_bff_client_id = "gentian-portal-bff"
    _validate_client_id(claims, settings)


def test_validate_client_id_rejects_wrong_client():
    claims = {"azp": "other-client"}
    settings = Settings()
    settings.oidc_client_id = "gentian-portal"
    settings.portal_bff_client_id = "gentian-portal-bff"
    with pytest.raises(jwt.InvalidAudienceError):
        _validate_client_id(claims, settings)


def test_issuer_allowed_accepts_kernel_and_tenant_realms():
    settings = Settings(
        KERNEL_DOMAIN="desk.gentian.org",
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
    )
    assert _issuer_allowed("https://id.desk.gentian.org/auth/realms/kernel", settings)
    assert _issuer_allowed("https://id.desk.gentian.org/auth/realms/demo", settings)
    assert _issuer_allowed(
        "http://keycloak.platform-kernel.svc:8080/auth/realms/demo",
        settings,
    )


def test_issuer_allowed_rejects_unknown_issuer():
    settings = Settings(
        KERNEL_DOMAIN="desk.gentian.org",
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
    )
    assert not _issuer_allowed("https://evil.example/auth/realms/demo", settings)


@pytest.mark.asyncio
async def test_logout_endpoint_auth_disabled():
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/auth/logout")
        assert response.status_code == 204


class _FakeStore:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def restore_workspace_email_for_login(self, realm: str, keycloak_username: str) -> None:
        self.calls.append((realm, keycloak_username))


@pytest.mark.asyncio
async def test_session_started_restores_email_when_store_configured():
    store = _FakeStore()
    settings = Settings(
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    claims = {
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "preferred_username": "jane@demo.desk.gentian.org",
    }
    await session_started(user=claims, settings=settings, credentials=None, store=store)
    assert store.calls == [("demo", "jane@demo.desk.gentian.org")]


@pytest.mark.asyncio
async def test_session_started_noop_when_store_not_configured():
    store = _FakeStore()
    settings = Settings()
    claims = {
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "preferred_username": "jane@demo.desk.gentian.org",
    }
    await session_started(user=claims, settings=settings, credentials=None, store=store)
    assert store.calls == []


@pytest.mark.asyncio
async def test_session_started_endpoint_auth_disabled():
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/auth/session-started")
        assert response.status_code == 204



# --- Proving the write path at login -----------------------------------------
#
# gentian-os will not destroy the installer's bootstrap credential until it has
# seen a token exchange succeed. Before this, the only thing that performed one
# was the admin console's Credentials tab, so "sign in to the portal" did not
# actually prove anything and handover waited on someone opening one page.


class _Creds:
    def __init__(self, token: str) -> None:
        self.credentials = token


@pytest.mark.asyncio
async def test_session_started_proves_write_path(monkeypatch):
    seen: list[str] = []

    async def _fake_prove(token, settings):
        seen.append(token)
        return True

    monkeypatch.setattr("app.api.routes.auth.prove_write_path", _fake_prove)
    await session_started(
        user={"iss": "https://id.x/auth/realms/demo", "preferred_username": "jane"},
        settings=Settings(),
        credentials=_Creds("a.jwt.token"),
        store=_FakeStore(),
    )
    assert seen == ["a.jwt.token"]


@pytest.mark.asyncio
async def test_session_started_survives_an_unreachable_credential_manager(monkeypatch):
    """A login must not fail because OpenBao is having a bad day."""

    async def _boom(token, settings):
        raise RuntimeError("openbao unreachable")

    monkeypatch.setattr("app.api.routes.auth.prove_write_path", _boom)
    with pytest.raises(RuntimeError):
        # prove_write_path swallows its own failures; this asserts that the
        # caller does not add a second layer of swallowing which would hide a
        # programming error in the service itself.
        await session_started(
            user={"iss": "https://id.x/auth/realms/demo", "preferred_username": "jane"},
            settings=Settings(),
            credentials=_Creds("a.jwt.token"),
            store=_FakeStore(),
        )


@pytest.mark.asyncio
async def test_session_started_without_a_bearer_does_not_attempt(monkeypatch):
    called = False

    async def _fake_prove(token, settings):
        nonlocal called
        called = True
        return True

    monkeypatch.setattr("app.api.routes.auth.prove_write_path", _fake_prove)
    await session_started(
        user={"iss": "https://id.x/auth/realms/demo", "preferred_username": "jane"},
        settings=Settings(),
        credentials=None,
        store=_FakeStore(),
    )
    assert called is False
