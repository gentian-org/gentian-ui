"""Tests for Keycloak browser SSO session bootstrap."""

from unittest.mock import patch

import httpx

from app.core.config import Settings
from app.services.keycloak_idp_session import create_idp_session_redirect, realm_from_issuer


def test_realm_from_issuer():
    assert realm_from_issuer("https://id.desk.gentian.org/auth/realms/demo") == "demo"


def test_create_idp_session_redirect_skips_non_bff_tokens():
    settings = Settings(
        PORTAL_BFF_CLIENT_ID="gentian-portal-bff",
        KEYCLOAK_ADMIN_URL="http://keycloak:8080/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    claims = {
        "sub": "user-id",
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "azp": "gentian-portal",
    }
    assert create_idp_session_redirect(claims, settings) is None


def test_create_idp_session_redirect_returns_redirect_url():
    settings = Settings(
        PORTAL_BFF_CLIENT_ID="gentian-portal-bff",
        KEYCLOAK_ADMIN_URL="http://keycloak:8080/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    claims = {
        "sub": "user-id",
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "azp": "gentian-portal-bff",
    }
    mock_response = httpx.Response(
        200,
        json={"redirect": "https://id.desk.gentian.org/auth/realms/demo/account"},
        request=httpx.Request("POST", "http://keycloak"),
    )
    with (
        patch(
            "app.services.keycloak_idp_session._fetch_admin_token",
            return_value="admin-token",
        ),
        patch("app.services.keycloak_idp_session.httpx.post", return_value=mock_response),
    ):
        redirect = create_idp_session_redirect(claims, settings)
    assert redirect == "https://id.desk.gentian.org/auth/realms/demo/account"
