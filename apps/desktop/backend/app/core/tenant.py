"""Which tenant this desktop serves.

One answer, from the operator. The desktop is a component installed into one
tenant, and GENTIAN_TENANT is what the component reconciler tells it — so the
tenant is a fact it was handed, not something to work out.

It used to be inferred, through a chain of five guesses: a tenant claim, then a
`gentian:tenant:<t>:*` group, then the realm parsed out of the issuer, then the
tenant a login-routing lookup derived from the email domain, then an `admin-`
prefix on the username. Every one of those was a second opinion about something
the platform already knew, and two of them needed things this service should not
have: a Keycloak admin lookup to learn the caller's groups, and the login-routing
table that belonged to a login page the edge has replaced.

A wrong answer here is not cosmetic — it selects which tenant's preferences and
notifications the caller sees — which is the reason it should come from one place
(gentian-os S7A.6).
"""

from typing import Any

from fastapi import HTTPException, status

from app.core.config import Settings


def resolve_user_context(claims: dict[str, Any], settings: Settings) -> str:
    """The tenant this component belongs to.

    The claims are still taken, and only as the local-development fallback:
    with AUTH_DISABLED the stub user carries a tenant and there is no operator
    to have set one.
    """
    if settings.gentian_tenant:
        return settings.gentian_tenant

    claim_tenant = claims.get("tenant")
    if claim_tenant:
        return str(claim_tenant)

    if settings.is_production:
        # In production this means the component was deployed without being
        # told which tenant it serves. Refusing is the safe direction: serving
        # the kernel domain's preferences to a tenant's people is worse than
        # serving nobody.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This desktop was not told which tenant it serves.",
        )
    return settings.kernel_domain
