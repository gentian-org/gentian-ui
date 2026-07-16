"""Tests for OIDC settings and token client validation."""

import jwt
import pytest

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

