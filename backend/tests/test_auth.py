"""Tests for OIDC settings and token client validation."""

import jwt
import pytest

from app.core.auth import _validate_client_id
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
    _validate_client_id(claims, "gentian-portal")


def test_validate_client_id_accepts_audience_list():
    claims = {"aud": ["account", "gentian-portal"]}
    _validate_client_id(claims, "gentian-portal")


def test_validate_client_id_rejects_wrong_client():
    claims = {"azp": "other-client"}
    with pytest.raises(jwt.InvalidAudienceError):
        _validate_client_id(claims, "gentian-portal")
