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


# Which realm the browser is redirected to decides where the SSO session is
# created. Send a tenant member to the kernel realm and the session lands
# somewhere none of their apps look.

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


# The tenant subdomain is the single-stage entry, reached directly rather than as
# a waypoint: a static gateway redirect cannot carry the email through, so the
# apex sends the browser straight to the realm with login_hint instead.


def test_tenant_subdomain_maps_to_the_same_realm_as_the_email() -> None:
    route = resolve_login_route(
        "john-doe@demo.desk.gentian.org",
        kernel_domain=_SETTINGS.kernel_domain,
        tenancy_mode=_SETTINGS.tenancy_mode,
    )
    # demo.desk.gentian.org and john-doe@demo.desk.gentian.org must resolve to one
    # realm, or the bookmarked entry and the apex would sign people in to
    # different places.
    assert route.idp_hint == "demo"
    assert _SETTINGS.public_issuer_for_realm(route.idp_hint).endswith("/realms/demo")


# The portal answers on the shared host and on every tenant's own host. Which
# realm a visitor signs in to is decided by the Host header, so the login page
# can skip the email question when the answer is already known.

from app.api.routes.auth import entry  # noqa: E402


class _Req:
    def __init__(self, host: str) -> None:
        self.headers = {"host": host}


def _entry(host: str):
    return entry(_Req(host), _SETTINGS)


def test_tenant_host_resolves_to_the_tenant_realm() -> None:
    assert _entry("demo.desk.gentian.org")["tenant"] == "demo"
    assert _entry("demo.desk.gentian.org")["issuer"].endswith("/realms/demo")


def test_port_is_ignored() -> None:
    assert _entry("demo.desk.gentian.org:443")["tenant"] == "demo"


def test_shared_portal_host_is_not_a_tenant() -> None:
    # Otherwise "portal" would be treated as a realm and nobody could sign in.
    assert _entry("portal.desk.gentian.org")["tenant"] is None
    assert _entry("portal.desk.gentian.org")["realm"] == "kernel"


def test_apex_is_not_a_tenant() -> None:
    assert _entry("desk.gentian.org")["tenant"] is None


def test_app_hostnames_are_not_portal_entries() -> None:
    # erp.demo.… is an app, two labels deep; treating it as tenant "erp.demo"
    # would send people to a realm that does not exist.
    assert _entry("erp.demo.desk.gentian.org")["tenant"] is None


def test_foreign_domains_are_not_tenants() -> None:
    assert _entry("demo.evil.example.com")["tenant"] is None


# tenantHost on /auth/login-route is what lets the apex hand a tenant member's
# sign-in over to their own host *before* the OIDC flow starts. redirect_uri is
# derived from window.location.origin at the moment the flow starts (oidc.ts), so
# starting it here and only linking to the tenant host afterwards does not
# canonicalise anything — the token exchange still finishes back on this host.

from app.api.routes.auth import login_route  # noqa: E402


def test_login_route_hands_a_tenant_member_to_their_own_host() -> None:
    result = login_route(email="john-doe@demo.desk.gentian.org", settings=_SETTINGS)
    assert result["tenantHost"] == "demo.desk.gentian.org"


def test_login_route_gives_an_operator_no_tenant_host() -> None:
    # Platform operators stay on the apex/portal host; there is no tenant realm
    # to hand them off to.
    result = login_route(email="ops@desk.gentian.org", settings=_SETTINGS)
    assert result["tenantHost"] is None
