import pytest

from app.core.login_routing import resolve_login_route


def test_platform_admin_uses_kernel_native_login():
    route = resolve_login_route(
        "administrator@desk.gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.kind == "platform"
    assert route.idp_hint is None


def test_bootstrap_tenant_admin_brokers_to_tenant():
    route = resolve_login_route(
        "admin-demo@gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.kind == "tenant"
    assert route.idp_hint == "demo"


def test_tenant_member_email_domain():
    route = resolve_login_route(
        "jane@demo.desk.gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.idp_hint == "demo"


def test_unknown_domain_raises():
    with pytest.raises(ValueError, match="No Gentian workspace"):
        resolve_login_route("user@unknown.example", kernel_domain="desk.gentian.org")
