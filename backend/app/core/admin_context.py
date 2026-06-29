"""Resolve tenant scope for Admin Console BFF routes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Query, status

from app.core.config import Settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_platform_superadmin,
    normalize_groups,
    tenant_admin_tenants,
)
from app.core.tenant import extract_tenant_from_claims


def resolve_admin_tenant(
    user: dict[str, Any],
    settings: Settings,
    requested_tenant: str | None,
) -> str:
    if settings.auth_disabled:
        return requested_tenant or str(user.get("tenant") or "demo")

    groups = normalize_groups(user)
    if is_platform_superadmin(groups):
        if requested_tenant:
            return requested_tenant
        claim_tenant = extract_tenant_from_claims(user)
        if claim_tenant and claim_tenant != settings.kernel_domain:
            return claim_tenant
        # Platform operators manage the shared kernel realm until a tenant is selected.
        return settings.kernel_realm

    admin_tenants = tenant_admin_tenants(groups)
    if not admin_tenants and is_bootstrap_tenant_admin(user):
        username = str(user.get("preferred_username") or user.get("email") or "")
        admin_tenants = [username.split("@", 1)[0].removeprefix("admin-")]
    if not admin_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant administrator privileges required",
        )

    if requested_tenant:
        if requested_tenant not in admin_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cross-tenant access denied",
            )
        return requested_tenant

    if len(admin_tenants) == 1:
        return admin_tenants[0]

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Query parameter tenant is required when administering multiple tenants",
    )


def admin_tenant_query(
    tenant: str | None = Query(default=None, description="Target tenant (platform admins)"),
) -> str | None:
    return tenant
