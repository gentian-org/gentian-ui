"""Gentian Keycloak group naming helpers."""

from __future__ import annotations

from typing import Any

PLATFORM_SUPERADMIN = "gentian:platform:superadmin"
PLATFORM_OPERATOR = "gentian:platform:operator"
PLATFORM_BREAK_GLASS = "gentian:platform:break-glass"
ROLE_MEMBER = "gentian:role:member"


def tenant_prefix(tenant: str) -> str:
    return f"gentian:tenant:{tenant}:"


def tenant_admins_group(tenant: str) -> str:
    return f"{tenant_prefix(tenant)}admins"


def tenant_members_group(tenant: str) -> str:
    return f"{tenant_prefix(tenant)}members"


def tenant_app_group(tenant: str, profile: str) -> str:
    return f"{tenant_prefix(tenant)}app:{profile}"


def is_tenant_managed_group(name: str, tenant: str) -> bool:
    prefix = tenant_prefix(tenant)
    if not name.startswith(prefix):
        return False
    if name == tenant_admins_group(tenant):
        return False
    return True


def normalize_groups(claims: dict) -> list[str]:
    raw = claims.get("groups")
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    return [str(g) for g in raw]


def tenant_admin_tenants(groups: list[str]) -> list[str]:
    tenants: list[str] = []
    for group in groups:
        if group.startswith("gentian:tenant:") and group.endswith(":admins"):
            parts = group.split(":")
            if len(parts) >= 4:
                tenants.append(parts[2])
    return tenants


def is_platform_superadmin(groups: list[str]) -> bool:
    return PLATFORM_SUPERADMIN in groups


def is_tenant_admin(groups: list[str]) -> bool:
    return bool(tenant_admin_tenants(groups))


def is_bootstrap_tenant_admin(user: dict[str, Any], tenant: str | None = None) -> bool:
    """Fallback until Keycloak group mappers emit gentian:tenant:<t>:admins in portal JWTs."""
    username = str(user.get("preferred_username") or user.get("email") or "")
    if not username.startswith("admin-"):
        return False
    local = username.split("@", 1)[0]
    inferred = local.removeprefix("admin-")
    if tenant is not None:
        return inferred == tenant
    return bool(inferred)


def user_is_tenant_admin(user: dict[str, Any], tenant: str | None = None) -> bool:
    groups = normalize_groups(user)
    if is_tenant_admin(groups):
        return True
    return is_bootstrap_tenant_admin(user, tenant)
