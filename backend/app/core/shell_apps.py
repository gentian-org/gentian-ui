"""Shell launcher apps for the Gentian portal."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    tenant_admins_group,
    tenant_app_group,
    tenant_members_group,
    user_is_platform_admin,
)
from app.core.tenant import extract_tenant_from_claims
from app.services.k8s_catalogue import get_app_profile, is_platform_app, list_installed_profiles

ADMIN_SHELL_APP = {
    "id": "admin",
    "title": "Admin Console",
    "icon": "admin",
    "launchUrl": None,
    "builtin": True,
}


def tenant_host(tenant: str, kernel_domain: str) -> str:
    return f"{tenant}.{kernel_domain.strip().lower()}"


def app_launch_url(
    profile_spec: dict[str, Any],
    *,
    tenant: str,
    kernel_domain: str,
    link_suffix: str = "",
) -> str | None:
    ingress = profile_spec.get("ingress") or {}
    sub_domain = ingress.get("subDomain")
    if not sub_domain:
        return None
    host = tenant_host(tenant, kernel_domain)
    suffix = link_suffix or ""
    if suffix and not suffix.startswith(("#", "/")):
        suffix = f"/{suffix.lstrip('/')}"
    return f"https://{sub_domain}.{host}{suffix}"


def tile_title(profile_spec: dict[str, Any], portal_tile: dict[str, Any]) -> str:
    display = portal_tile.get("displayName") or {}
    for key in ("en_US", "en", "de_DE"):
        if display.get(key):
            return str(display[key])
    if profile_spec.get("displayName"):
        return str(profile_spec["displayName"])
    return str(portal_tile.get("name") or profile_spec.get("compositionRef") or "App")


def tile_icon(profile_spec: dict[str, Any], portal_tile: dict[str, Any]) -> str:
    tile_spec = portal_tile.get("tile") or {}
    if tile_spec.get("icon"):
        return str(tile_spec["icon"])
    profile_tile = profile_spec.get("tile") or {}
    if profile_tile.get("icon"):
        return str(profile_tile["icon"])
    return "app"


def user_can_see_portal_tile(
    groups: list[str],
    *,
    tenant: str,
    profile: str,
    allowed_group: str,
    is_admin: bool,
) -> bool:
    if is_admin:
        return True
    if tenant_app_group(tenant, profile) in groups:
        return True
    normalized = (allowed_group or "Domain Users").strip()
    if normalized in {"Tenant Admins", "Domain Admins"}:
        return tenant_admins_group(tenant) in groups
    if normalized in {"App Users", "Domain Users"}:
        return tenant_members_group(tenant) in groups
    if normalized.startswith("managed-by-attribute-"):
        return tenant_app_group(tenant, profile) in groups
    return tenant_members_group(tenant) in groups


def tenant_shell_apps(
    user: dict[str, Any],
    settings: Settings,
    *,
    groups: list[str],
    is_admin: bool,
) -> list[dict[str, Any]]:
    tenant = str(user.get("tenant") or extract_tenant_from_claims(user) or "")
    if not tenant or tenant == settings.kernel_domain:
        return []

    apps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for profile_name in list_installed_profiles(tenant):
        profile = get_app_profile(profile_name)
        if profile is None:
            continue
        if is_platform_app(profile):
            continue
        spec = profile.get("spec") or {}
        portal_tiles = spec.get("portalTiles") or []
        if not portal_tiles:
            continue
        for portal_tile in portal_tiles:
            if not user_can_see_portal_tile(
                groups,
                tenant=tenant,
                profile=profile_name,
                allowed_group=str(portal_tile.get("allowedGroup") or ""),
                is_admin=is_admin,
            ):
                continue
            tile_name = str(portal_tile.get("name") or profile_name)
            app_id = f"{profile_name}-{tile_name}"
            if app_id in seen:
                continue
            launch_url = app_launch_url(
                spec,
                tenant=tenant,
                kernel_domain=settings.kernel_domain,
                link_suffix=str(portal_tile.get("linkSuffix") or ""),
            )
            if launch_url is None:
                continue
            seen.add(app_id)
            apps.append(
                {
                    "id": app_id,
                    "title": tile_title(spec, portal_tile),
                    "icon": tile_icon(spec, portal_tile),
                    "launchUrl": launch_url,
                    "builtin": False,
                }
            )
    return apps


def shell_apps_for_user(user: dict[str, Any], settings: Settings) -> list[dict[str, Any]]:
    groups = normalize_groups(user)
    if settings.auth_disabled:
        groups = groups or ["gentian:tenant:demo:admins", "gentian:tenant:demo:members"]
    is_admin = (
        settings.auth_disabled
        or user_is_platform_admin(user)
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user)
    )

    apps = tenant_shell_apps(user, settings, groups=groups, is_admin=is_admin)
    if is_admin:
        apps.append(dict(ADMIN_SHELL_APP))
    return apps
