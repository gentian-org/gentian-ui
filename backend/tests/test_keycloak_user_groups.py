"""Tests for Keycloak group lookup fallback."""

from unittest.mock import patch

from app.core.config import Settings
from app.services.keycloak_user_groups import lookup_user_groups, realm_from_issuer


def test_realm_from_issuer():
    assert realm_from_issuer("https://id.desk.gentian.org/auth/realms/demo") == "demo"


def test_lookup_user_groups_from_admin_api():
    settings = Settings(
        KEYCLOAK_ADMIN_URL="http://keycloak/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    claims = {
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "sub": "user-123",
    }
    with patch(
        "app.services.keycloak_user_groups._fetch_admin_token",
        return_value="token",
    ), patch(
        "app.services.keycloak_user_groups.httpx.get",
    ) as mock_get:
        mock_get.return_value.raise_for_status = lambda: None
        mock_get.return_value.json.return_value = [
            {"name": "gentian:tenant:demo:app:element"},
            {"name": "gentian:tenant:demo:members"},
        ]
        groups = lookup_user_groups(claims, settings)
    assert groups == [
        "gentian:tenant:demo:app:element",
        "gentian:tenant:demo:members",
    ]
