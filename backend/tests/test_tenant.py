"""Which tenant this desktop serves.

One fact from the operator, with a local-development fallback. The old test
file asserted a five-step inference chain -- a tenant claim, a group name, the
realm in the issuer, a login-routing lookup on the email domain, an `admin-`
prefix -- and every one of those was a second opinion about something the
platform already knew. Two of them needed a Keycloak administrator credential
to answer. The chain is gone (gentian-os S7A.6), so what is left to assert is
the precedence and the refusal.
"""

import pytest
from fastapi import HTTPException

from app.core.config import Settings
from app.core.tenant import resolve_user_context


def _settings(**kw) -> Settings:
    base = dict(AUTH_DISABLED="true", KERNEL_DOMAIN="desk.gentian.org", ENVIRONMENT="local")
    base.update(kw)
    return Settings(**base)


def test_the_operators_answer_wins():
    s = _settings(GENTIAN_TENANT="demo")
    # Even against a claim that says something else: the claim is the caller's,
    # the tenant is the component's, and a caller cannot move themselves into
    # another tenant's preferences by carrying a different claim.
    assert resolve_user_context({"tenant": "other"}, s) == "demo"


def test_the_claim_is_the_local_development_fallback():
    s = _settings()
    assert resolve_user_context({"tenant": "demo"}, s) == "demo"


def test_production_without_a_tenant_is_refused():
    s = _settings(ENVIRONMENT="production", AUTH_DISABLED="false")
    # A component deployed without being told which tenant it serves. Serving
    # the kernel domain's preferences to a tenant's people is worse than
    # serving nobody, so this refuses rather than guessing.
    with pytest.raises(HTTPException) as exc:
        resolve_user_context({}, s)
    assert exc.value.status_code == 403


def test_local_development_without_a_tenant_falls_back_to_the_kernel_domain():
    s = _settings()
    assert resolve_user_context({}, s) == "desk.gentian.org"
