"""Tests for tenant claim resolution."""

from app.core.config import Settings
from app.core.tenant import extract_tenant_from_claims, resolve_user_context


def test_extract_tenant_from_member_group():
    claims = {"groups": ["gentian:tenant:demo:members"]}
    assert extract_tenant_from_claims(claims, kernel_domain="desk.gentian.org") == "demo"


def test_extract_tenant_from_issuer_realm():
    claims = {"iss": "https://id.desk.gentian.org/auth/realms/demo"}
    assert extract_tenant_from_claims(
        claims,
        kernel_domain="desk.gentian.org",
        kernel_realm="kernel",
    ) == "demo"


def test_extract_tenant_from_workspace_email():
    claims = {"email": "john-doe@demo.desk.gentian.org"}
    assert extract_tenant_from_claims(claims, kernel_domain="desk.gentian.org") == "demo"


def test_resolve_user_context_for_tenant_member():
    settings = Settings(
        KERNEL_DOMAIN="desk.gentian.org",
        KERNEL_REALM="kernel",
        ENVIRONMENT="development",
    )
    claims = {
        "iss": "https://id.desk.gentian.org/auth/realms/demo",
        "email": "john-doe@demo.desk.gentian.org",
        "groups": ["gentian:tenant:demo:members", "gentian:tenant:demo:app:element"],
    }
    assert resolve_user_context(claims, settings) == "demo"
