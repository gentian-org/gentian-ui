"""User tenant/realm context from JWT (M4).

Catalogue apps pin a workload TENANT_ID and assert claims match. The kernel shell
serves users from multiple Keycloak realms — tenant context comes from JWT claims
only (see extract_tenant_from_claims).
"""

from typing import Any

from fastapi import HTTPException, status

from app.core.config import Settings
from app.core.login_routing import resolve_login_route
from app.services.keycloak_user_groups import realm_from_issuer


def extract_tenant_from_claims(
    claims: dict[str, Any],
    *,
    kernel_domain: str | None = None,
    kernel_realm: str | None = None,
    tenancy_mode: str = "multi",
) -> str | None:
    """Resolve tenant id from standard Gentian / Keycloak claim shapes."""
    for key in ("tenant", "tenant_id", "tenantId"):
        value = claims.get(key)
        if value:
            tenant = str(value)
            if kernel_domain and tenant == kernel_domain:
                pass
            else:
                return tenant

    groups = claims.get("groups") or claims.get("realm_access", {}).get("roles") or []
    if isinstance(groups, str):
        groups = [groups]
    for group in groups:
        group_str = str(group)
        if group_str.startswith("gentian:tenant:"):
            parts = group_str.split(":")
            if len(parts) >= 3:
                return parts[2]
        if group_str.startswith("tenant:"):
            return group_str.removeprefix("tenant:")

    issuer = str(claims.get("iss") or "")
    realm = realm_from_issuer(issuer)
    if realm and realm not in {"master", kernel_realm or "kernel"}:
        return realm

    email = str(claims.get("email") or claims.get("preferred_username") or "")
    if kernel_domain and "@" in email:
        try:
            route = resolve_login_route(
                email,
                kernel_domain=kernel_domain,
                tenancy_mode=tenancy_mode,
            )
        except ValueError:
            route = None
        if route is not None and route.kind == "tenant" and route.idp_hint:
            return route.idp_hint

    sub = str(claims.get("preferred_username") or claims.get("sub") or "")
    if sub.startswith("admin-"):
        return sub.removeprefix("admin-").split("@", 1)[0]

    return None


def resolve_user_context(claims: dict[str, Any], settings: Settings) -> str:
    """Attach tenant context to authenticated shell users."""
    claim_tenant = extract_tenant_from_claims(
        claims,
        kernel_domain=settings.kernel_domain,
        kernel_realm=settings.kernel_realm,
        tenancy_mode=settings.tenancy_mode,
    )

    if settings.is_production and claim_tenant is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing tenant claim",
        )

    return claim_tenant or settings.kernel_domain
