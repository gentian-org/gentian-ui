"""Tests for password-login realm resolution."""

from unittest.mock import patch

import pytest

from app.core.config import Settings
from app.services.keycloak_password_login import resolve_password_login_route


def test_external_invite_email_falls_back_to_keycloak_lookup():
    settings = Settings(
        KERNEL_DOMAIN="desk.gentian.org",
        KERNEL_REALM="kernel",
        KEYCLOAK_ADMIN_URL="http://keycloak/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    with patch(
        "app.services.keycloak_password_login._locate_user_in_keycloak",
        return_value=("demo", "ch.braendli@proton.me"),
    ):
        route = resolve_password_login_route("ch.braendli@proton.me", settings)
    assert route.idp_hint == "demo"
    assert route.keycloak_username == "ch.braendli@proton.me"
    assert route.kind == "tenant"


def test_unknown_external_email_still_raises():
    settings = Settings(
        KERNEL_DOMAIN="desk.gentian.org",
        KEYCLOAK_ADMIN_URL="http://keycloak/auth",
        KEYCLOAK_ADMIN_PASSWORD="secret",
    )
    with patch("app.services.keycloak_password_login._locate_user_in_keycloak", return_value=None):
        with pytest.raises(ValueError, match="No Gentian workspace"):
            resolve_password_login_route("nobody@example.com", settings)
