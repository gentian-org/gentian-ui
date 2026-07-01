"""Tests for Gentian group naming and bootstrap admin helpers."""

from app.core.gentian_groups import (
    is_admin_managed_group,
    is_app_entitlement_group,
    is_platform_bootstrap_admin,
    is_platform_managed_group,
    is_privilege_group,
    is_system_tenant_group,
    tenant_app_admins_group,
    user_is_platform_admin,
)


def test_platform_bootstrap_administrator_user():
    user = {"preferred_username": "administrator"}
    assert is_platform_bootstrap_admin(user)
    assert user_is_platform_admin(user)


def test_platform_bootstrap_administrator_email():
    user = {"email": "administrator@desk.gentian.org"}
    assert is_platform_bootstrap_admin(user)


def test_platform_managed_group():
    assert is_platform_managed_group("gentian:platform:superadmin")
    assert not is_platform_managed_group("gentian:tenant:demo:app:mail")


def test_kernel_scope_uses_platform_groups():
    assert is_admin_managed_group(
        "gentian:platform:superadmin",
        "kernel",
        kernel_realm="kernel",
    )
    assert not is_admin_managed_group(
        "gentian:tenant:demo:app:mail",
        "kernel",
        kernel_realm="kernel",
    )


def test_tenant_privilege_group_helpers():
    tenant = "demo"
    app_admins = tenant_app_admins_group(tenant)
    assert is_privilege_group(app_admins, tenant)
    assert is_system_tenant_group(app_admins, tenant)
    assert is_admin_managed_group(app_admins, tenant)
    assert is_app_entitlement_group("gentian:tenant:demo:app:nextcloud", tenant)
    assert not is_app_entitlement_group(app_admins, tenant)
