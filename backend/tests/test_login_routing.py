import pytest

from app.core.login_routing import resolve_login_route


def test_platform_admin_uses_kernel_native_login():
    route = resolve_login_route(
        "administrator@desk.gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.kind == "platform"
    assert route.idp_hint is None
    assert route.keycloak_username == "administrator@desk.gentian.org"


def test_bootstrap_tenant_admin_brokers_to_tenant():
    route = resolve_login_route(
        "admin-demo@gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.kind == "tenant"
    assert route.idp_hint == "demo"
    assert route.keycloak_username == "admin-demo"


def test_tenant_member_email_domain():
    route = resolve_login_route(
        "jane@demo.desk.gentian.org",
        kernel_domain="desk.gentian.org",
    )
    assert route.idp_hint == "demo"


def test_unknown_domain_raises():
    with pytest.raises(ValueError, match="No Gentian workspace"):
        resolve_login_route("user@unknown.example", kernel_domain="desk.gentian.org")


# Which realm the browser is redirected to decides where the SSO session is
# created. Send a tenant member to the kernel realm and the session lands
# somewhere none of their apps look, which is the failure docs/login-cleanup.md
# was written about.

from app.core.config import Settings  # noqa: E402

_SETTINGS = Settings(
    OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
    KERNEL_DOMAIN="desk.gentian.org",
    KERNEL_REALM="kernel",
)


def _issuer_for(email: str) -> str:
    route = resolve_login_route(
        email, kernel_domain=_SETTINGS.kernel_domain, tenancy_mode=_SETTINGS.tenancy_mode
    )
    realm = _SETTINGS.kernel_realm if route.idp_hint is None else route.idp_hint
    return _SETTINGS.public_issuer_for_realm(realm)


def test_tenant_member_authenticates_in_their_own_realm() -> None:
    assert _issuer_for("john-doe@demo.desk.gentian.org").endswith("/realms/demo")


def test_tenant_bootstrap_admin_authenticates_in_the_tenant_realm() -> None:
    assert _issuer_for("admin-demo@desk.gentian.org").endswith("/realms/demo")


def test_platform_operator_authenticates_in_the_kernel_realm() -> None:
    assert _issuer_for("ops@desk.gentian.org").endswith("/realms/kernel")


def test_public_issuer_keeps_scheme_host_and_auth_prefix() -> None:
    # Rebuilt from parts this would silently drop the /auth prefix on a
    # deployment that serves Keycloak under one.
    assert (
        _SETTINGS.public_issuer_for_realm("demo")
        == "https://id.desk.gentian.org/auth/realms/demo"
    )


def test_public_issuer_falls_back_when_no_issuer_is_configured() -> None:
    s = Settings(OIDC_ISSUER="", KERNEL_DOMAIN="desk.gentian.org")
    assert s.public_issuer_for_realm("demo") == "https://id.desk.gentian.org/auth/realms/demo"
