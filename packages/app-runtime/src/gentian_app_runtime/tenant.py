"""Tenant scoping helpers (M4, M26).

Every handler must operate within the workload's configured tenant. Never trust
client-supplied tenant IDs without matching JWT claims or platform injection.
"""

from typing import Any, Protocol

from fastapi import HTTPException, status


class TenantSettings(Protocol):
    """What an app's Settings must answer for this module."""

    tenant_id: str

    @property
    def is_edge(self) -> bool: ...

    @property
    def is_production(self) -> bool: ...


def extract_tenant_from_claims(claims: dict[str, Any]) -> str | None:
    """The tenant a token names in a claim of its own, or None. A group or a
    username names nobody's tenant."""
    for key in ("tenant", "tenant_id", "tenantId"):
        value = claims.get(key)
        if value:
            return str(value)

    return None


def assert_tenant_access(claims: dict[str, Any], settings: TenantSettings) -> str:
    """Ensure the authenticated user belongs to this workload's tenant.

    Under edge, tenancy is not a claim in the token. The zone's token names
    nobody's tenant; the component itself is IN a tenant, which the platform
    told it, and whether this caller may enter that tenant was decided at the
    edge before the request arrived, from the authorization graph. Asking the
    token would refuse every caller in production, since the platform sets
    ENVIRONMENT=production and the claim is never there. Anything finer than
    "may enter" is the director's answer, obtained by relaying the token.
    """
    if settings.is_edge:
        return settings.tenant_id
    claim_tenant = extract_tenant_from_claims(claims)

    if settings.is_production and claim_tenant is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing tenant claim",
        )

    effective = claim_tenant or settings.tenant_id
    if claim_tenant and claim_tenant != settings.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    return effective
