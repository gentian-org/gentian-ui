"""User tenant/realm context from JWT (M4).

Catalogue apps pin a workload TENANT_ID and assert claims match. The kernel shell
serves users from multiple Keycloak realms — tenant context comes from JWT claims
only (see extract_tenant_from_claims).
"""

from typing import Any

from fastapi import HTTPException, status

from app.core.config import Settings


def extract_tenant_from_claims(claims: dict[str, Any]) -> str | None:
    """Resolve tenant id from standard Gentian / Keycloak claim shapes."""
    for key in ("tenant", "tenant_id", "tenantId"):
        value = claims.get(key)
        if value:
            return str(value)

    groups = claims.get("groups") or claims.get("realm_access", {}).get("roles") or []
    for group in groups:
        group_str = str(group)
        if group_str.startswith("tenant:"):
            return group_str.removeprefix("tenant:")

    sub = str(claims.get("preferred_username") or claims.get("sub") or "")
    if sub.startswith("admin-"):
        return sub.removeprefix("admin-").split("@", 1)[0]

    return None


def resolve_user_context(claims: dict[str, Any], settings: Settings) -> str:
    """Attach tenant context to authenticated shell users."""
    claim_tenant = extract_tenant_from_claims(claims)

    if settings.is_production and claim_tenant is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing tenant claim",
        )

    return claim_tenant or settings.kernel_domain
