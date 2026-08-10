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
from app.services.k8s_catalogue import get_app_profile, is_platform_app, list_installed_profiles, list_platform_app_profiles

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
    if api.get("runtime") == "portal-proxy" and profile_spec.get("ingress", {}).get("subDomain"):
        return None
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
    tenant_binding = profile_spec.get("tenantBinding", "isolated")
    if tenant_binding == "none":
        host = kernel_domain.strip().lower()
    else:
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


def profile_auth_mode(profile: dict[str, Any], profile_name: str) -> str | None:
    # First check: generic metadata annotation override
    annotations = profile.get("metadata", {}).get("annotations") or {}
    portal_auth_mode = annotations.get("gentianos.io/portal-auth-mode")
    if portal_auth_mode:
        return portal_auth_mode

    # Backwards compatibility: fallback to hardcoded matching
    profile_spec = profile.get("spec") or {}
    # App Store runs with auth.disabled when embedded in the portal shell; the portal
    # already authenticated the tenant admin — no Keycloak browser bootstrap needed.
    extra_values = profile_spec.get("extraValues") or {}
    if extra_values.get("auth", {}).get("disabled") is True:
        return None

    identity = (profile_spec.get("kernelRequirements") or {}).get("identity") or {}
    if identity.get("oidc"):
        return "oidc"
    return None


def tile_icon(profile_spec: dict[str, Any], portal_tile: dict[str, Any]) -> str:
    tile_spec = portal_tile.get("tile") or {}
    if tile_spec.get("logo"):
        return str(tile_spec["logo"])
    if tile_spec.get("icon"):
        return str(tile_spec["icon"])
    profile_tile = profile_spec.get("tile") or {}
    if profile_tile.get("logo"):
        return str(profile_tile["logo"])
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
    platform_profiles = list_platform_app_profiles()
    for p in platform_profiles:
        if p not in profiles:
            profiles.append(p)
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
        spec = profile.get("spec") or {}
        portal_tiles = spec.get("portalTiles") or []
        if not portal_tiles:
            continue
        for portal_tile in portal_tiles:
            # Odoo addons are gated per user: a member sees the tile only if one of
            # their Keycloak groups grants that module via gentianOdooModules.
            #
            # This used to key on requires-profile == "odoo-cb-base" and strip an
            # "odoo-cb-" prefix. Both were stale from the profile rename, so the whole
            # gate had been silently inert — every member saw every Odoo tile. It now
            # keys on the addon declaration, which is also where the module's real
            # Odoo name lives (crm, account, hr), rather than being guessed from the
            # profile name.
            #
            # Known debt: this is app-specific gating living in the portal. It belongs
            # with the entitlement model, so that visibility is decided the same way
            # for every app rather than once per family here.
            addon_of = ((spec.get("customization") or {}).get("addon") or {})
            is_odoo_addon = bool(addon_of.get("of")) and spec.get("family") == "odoo"
            if is_odoo_addon and not is_admin:
                module_name = addon_of.get("id") or profile_name
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
            url_spec = spec
            auth_profile, auth_profile_name = profile, profile_name
            if not spec.get("ingress") and not spec.get("apiIntegration"):
                # An addon has no ingress of its own — it is reached inside its base
                # app — so the tile URL comes from the base. spec.customization.addon.of
                # is the current declaration; requires-profile is the legacy annotation
                # kept for profiles not yet migrated.
                addon_decl = (spec.get("customization") or {}).get("addon") or {}
                base_name = addon_decl.get("of")
                if base_name:
                    base_profile = get_app_profile(str(base_name))
                    if base_profile and base_profile.get("spec"):
                        url_spec = base_profile["spec"]
                        auth_profile_name = str(base_name)
                        # The addon is reached inside the base, over the base's own
                        # session, so it must launch the same way. Without this the
                        # tile falls back to plain navigation: the portal bridge never
                        # runs, ?open=/?app= are never interpreted, and every addon
                        # tile lands on Nextcloud's dashboard instead of its target.
                        auth_profile = base_profile
            launch_url = app_launch_url(
                url_spec,
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
                    "authMode": profile_auth_mode(auth_profile, auth_profile_name),
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
