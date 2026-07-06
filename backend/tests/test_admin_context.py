"""Tests for Admin Console tenant scoping."""

import pytest
from fastapi import HTTPException

from app.core.admin_context import resolve_admin_tenant
from app.core.config import Settings


def _settings(**overrides) -> Settings:
    s = Settings(
        ENVIRONMENT="local",
        KERNEL_DOMAIN="desk.gentian.org",
    )
    s.auth_disabled = overrides.get("auth_disabled", overrides.get("AUTH_DISABLED", False))
    for k, v in overrides.items():
        if k.upper() != "AUTH_DISABLED":
            setattr(s, k.lower(), v)
    return s


def test_tenant_admin_scoped_to_own_tenant():
    user = {"groups": ["gentian:tenant:demo:admins"]}
    tenant = resolve_admin_tenant(user, _settings(), None)
    assert tenant == "demo"


def test_tenant_admin_rejects_cross_tenant():
    user = {"groups": ["gentian:tenant:demo:admins"]}
    with pytest.raises(HTTPException) as exc:
        resolve_admin_tenant(user, _settings(), "acme")
    assert exc.value.status_code == 403


def test_platform_admin_defaults_kernel_realm():
    user = {"groups": ["gentian:platform:superadmin"]}
    tenant = resolve_admin_tenant(user, _settings(), None)
    assert tenant == "kernel"


def test_platform_bootstrap_administrator_defaults_kernel_realm():
    user = {"preferred_username": "administrator"}
    tenant = resolve_admin_tenant(user, _settings(), None)
    assert tenant == "kernel"


def test_platform_admin_can_target_tenant():
    user = {"groups": ["gentian:platform:superadmin"]}
    tenant = resolve_admin_tenant(user, _settings(), "demo")
    assert tenant == "demo"


def test_auth_disabled_defaults_demo():
    user = {"tenant": "demo"}
    tenant = resolve_admin_tenant(user, _settings(AUTH_DISABLED=True), None)
    assert tenant == "demo"
