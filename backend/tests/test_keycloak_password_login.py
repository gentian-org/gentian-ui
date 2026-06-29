"""Tests for Keycloak password login helpers."""

from app.core.login_routing import LoginRoute
from app.core.config import Settings
from app.services.keycloak_password_login import realm_issuer


def test_realm_issuer_uses_auth_prefix():
    settings = Settings(
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        KERNEL_REALM="kernel",
    )
    assert realm_issuer(settings, "demo") == "https://id.desk.gentian.org/auth/realms/demo"


def test_realm_issuer_kernel_from_admin_url():
    settings = Settings(
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
        KERNEL_REALM="kernel",
    )
    assert realm_issuer(settings, "kernel") == "http://keycloak.platform-kernel.svc:8080/auth/realms/kernel"
