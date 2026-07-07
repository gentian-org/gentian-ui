"""Shell launcher apps for the Gentian portal."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.core.gentian_groups import (
    is_bootstrap_tenant_admin,
    is_tenant_admin,
    normalize_groups,
    tenant_app_group,
    tenant_members_group,
    user_is_platform_admin,
)
from app.core.tenant import extract_tenant_from_claims
from app.services.admin_store import AdminStore
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


def api_integration_launch_url(profile_spec: dict[str, Any], *, tenant: str, kernel_domain: str) -> str | None:
    """Launch URL for an ApiProfile (deploymentMethod: api): redirect to an
    external service, optionally bound to the tenant effective domain."""
    if profile_spec.get("deploymentMethod") != "api":
        return None
    api = profile_spec.get("apiIntegration") or {}
    base = str(api.get("baseUrl") or "").rstrip("/")
    if not base:
        return None
    if str(api.get("tenantBinding") or "tenant-domain") == "tenant-domain":
        host = tenant_host(tenant, kernel_domain)
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}tenantDomain={host}"
    return base


def app_launch_url(
    profile_spec: dict[str, Any],
    *,
    tenant: str,
    kernel_domain: str,
    link_suffix: str = "",
) -> str | None:
    api_url = api_integration_launch_url(profile_spec, tenant=tenant, kernel_domain=kernel_domain)
    if api_url is not None:
        return api_url
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


def profile_auth_mode(profile_spec: dict[str, Any], profile_name: str) -> str | None:
    # App Store runs with auth.disabled when embedded in the portal shell; the portal
    # already authenticated the tenant admin — no Keycloak browser bootstrap needed.
    extra_values = profile_spec.get("extraValues") or {}
    if extra_values.get("auth", {}).get("disabled") is True:
        return None

    identity = (profile_spec.get("kernelRequirements") or {}).get("identity") or {}
    if identity.get("oidc"):
        if profile_name == "element":
            return "matrix-bridge"
        if profile_name == "nextcloud":
            return "nextcloud-bridge"
        if profile_name == "openproject":
            return "openproject-bridge"
        return "oidc"
    return None


def tile_icon(profile_spec: dict[str, Any], portal_tile: dict[str, Any]) -> str:
    tile_spec = portal_tile.get("tile") or {}
    if tile_spec.get("icon"):
        return str(tile_spec["icon"])
    profile_tile = profile_spec.get("tile") or {}
    if profile_tile.get("icon"):
        return str(profile_tile["icon"])
    return "app"


def is_admin_portal_tile(allowed_group: str) -> bool:
    normalized = (allowed_group or "").strip()
    return normalized in {"Tenant Admins", "Domain Admins"}


def user_can_see_portal_tile(
    groups: list[str],
    *,
    tenant: str,
    profile: str,
    allowed_group: str,
    is_admin: bool,
) -> bool:
    normalized = (allowed_group or "Domain Users").strip()

    if is_admin:
        return is_admin_portal_tile(normalized)

    if is_admin_portal_tile(normalized):
        return False

    if tenant_app_group(tenant, profile) in groups:
        return True
    if normalized in {"App Users", "Domain Users"}:
        return tenant_members_group(tenant) in groups
    if normalized.startswith("managed-by-attribute-"):
        return tenant_app_group(tenant, profile) in groups
    return tenant_members_group(tenant) in groups


def _profiles_for_shell_tiles(tenant: str, *, is_admin: bool) -> list[str]:
    profiles = list_installed_profiles(tenant)
    if is_admin and "app-store" not in profiles:
        profiles.append("app-store")
    return profiles


async def tenant_shell_apps(
    user: dict[str, Any],
    settings: Settings,
    store: AdminStore | None = None,
    *,
    groups: list[str],
    is_admin: bool,
) -> list[dict[str, Any]]:
    tenant = str(user.get("tenant") or extract_tenant_from_claims(user) or "")
    if not tenant or tenant == settings.kernel_domain:
        return []

    apps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for profile_name in _profiles_for_shell_tiles(tenant, is_admin=is_admin):
        profile = get_app_profile(profile_name)
        if profile is None:
            continue
        if is_platform_app(profile) and not is_admin:
            continue
        spec = profile.get("spec") or {}
        portal_tiles = spec.get("portalTiles") or []
        if not portal_tiles:
            continue
        for portal_tile in portal_tiles:
            is_odoo_module = profile_name.startswith("odoo-cb-") and profile_name != "odoo-cb-base"
            if is_odoo_module and not is_admin:
                module_name = profile_name.removeprefix("odoo-cb-")
                from app.services.keycloak_user_groups import realm_from_issuer
                realm = realm_from_issuer(user.get("iss") or "") or f"tenant-{tenant}"
                all_kc_groups = []
                if store is not None:
                    try:
                        all_kc_groups = await store.list_groups(realm)
                    except Exception:
                        pass
                
                user_group_paths = {g.lstrip("/") for g in groups}
                user_kc_groups = [
                    g for g in all_kc_groups
                    if g.path.lstrip("/") in user_group_paths or g.name in user_group_paths
                ]
                
                has_grant = False
                for g in user_kc_groups:
                    if "*" in g.gentian_odoo_modules or module_name in g.gentian_odoo_modules:
                        has_grant = True
                        break
                
                if not has_grant:
                    continue
            else:
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
                    "linkTarget": str(portal_tile.get("linkTarget") or "newwindow"),
                    "authMode": profile_auth_mode(spec, profile_name),
                    "builtin": False,
                }
            )
    return apps


async def shell_apps_for_user(
    user: dict[str, Any],
    settings: Settings,
    store: AdminStore | None = None,
) -> list[dict[str, Any]]:
    groups = normalize_groups(user)
    if settings.auth_disabled:
        groups = groups or ["gentian:tenant:demo:admins", "gentian:tenant:demo:members"]
    is_admin = (
        settings.auth_disabled
        or user_is_platform_admin(user)
        or is_tenant_admin(groups)
        or is_bootstrap_tenant_admin(user)
    )

    apps = await tenant_shell_apps(user, settings, store, groups=groups, is_admin=is_admin)
    if is_admin:
        apps.append(dict(ADMIN_SHELL_APP))
    return apps
