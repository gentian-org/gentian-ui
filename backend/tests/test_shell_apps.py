"""Tests for shell launcher app resolution."""

from unittest.mock import patch

from app.core.config import Settings
from app.core.shell_apps import (
    app_launch_url,
    is_admin_portal_tile,
    shell_apps_for_user,
    user_can_see_portal_tile,
)

APP_STORE_PROFILE = {
    "metadata": {"name": "app-store", "annotations": {"gentianos.io/platform-app": "true"}},
    "spec": {
        "displayName": "App Store",
        "ingress": {"subDomain": "store"},
        "tile": {"icon": "store"},
        "extraValues": {"auth": {"disabled": True}},
        "kernelRequirements": {"identity": {"oidc": {"clientId": "app-store"}}},
        "portalTiles": [
            {
                "name": "app-store",
                "displayName": {"en_US": "App Store"},
                "allowedGroup": "Tenant Admins",
                "linkTarget": "embedded",
            }
        ],
    },
}

ELEMENT_PROFILE = {
    "metadata": {"name": "element"},
    "spec": {
        "displayName": "Element (Matrix)",
        "ingress": {"subDomain": "chat"},
        "tile": {"icon": "chat"},
        "kernelRequirements": {"identity": {"oidc": {"clientId": "opendesk-synapse"}}},
        "portalTiles": [
            {
                "name": "element",
                "displayName": {"en_US": "Chat"},
                "allowedGroup": "App Users",
                "linkTarget": "embedded",
            }
        ],
    },
}

OPENPROJECT_PROFILE = {
    "metadata": {"name": "openproject"},
    "spec": {
        "displayName": "OpenProject",
        "ingress": {"subDomain": "projects"},
        "tile": {"icon": "projects"},
        "kernelRequirements": {"identity": {"oidc": {"clientId": "gentian-openproject"}}},
        "portalTiles": [
            {
                "name": "openproject",
                "displayName": {"en_US": "Projects"},
                "allowedGroup": "App Users",
                "linkTarget": "embedded",
            }
        ],
    },
}


def test_app_launch_url_uses_tenant_subdomain():
    spec = {"ingress": {"subDomain": "chat"}}
    assert (
        app_launch_url(spec, tenant="demo", kernel_domain="desk.gentian.org")
        == "https://chat.demo.desk.gentian.org"
    )


def test_app_launch_url_api_profile_binds_tenant_domain():
    spec = {
        "deploymentMethod": "api",
        "apiIntegration": {
            "runtime": "redirect",
            "baseUrl": "https://corp.gentian.org",
            "tenantBinding": "tenant-domain",
        },
    }
    assert (
        app_launch_url(spec, tenant="demo", kernel_domain="desk.gentian.org")
        == "https://corp.gentian.org?tenantDomain=demo.desk.gentian.org"
    )


def test_app_launch_url_api_profile_without_tenant_binding():
    spec = {
        "deploymentMethod": "api",
        "apiIntegration": {"baseUrl": "https://corp.gentian.org/", "tenantBinding": "none"},
    }
    assert (
        app_launch_url(spec, tenant="demo", kernel_domain="desk.gentian.org")
        == "https://corp.gentian.org"
    )


def test_is_admin_portal_tile():
    assert is_admin_portal_tile("Tenant Admins")
    assert not is_admin_portal_tile("App Users")


def test_user_can_see_portal_tile_with_app_entitlement():
    groups = ["gentian:tenant:demo:app:element"]
    assert user_can_see_portal_tile(
        groups,
        tenant="demo",
        profile="element",
        allowed_group="App Users",
        is_admin=False,
    )


def test_tenant_admin_does_not_see_member_app_tile():
    groups = ["gentian:tenant:demo:admins"]
    assert not user_can_see_portal_tile(
        groups,
        tenant="demo",
        profile="element",
        allowed_group="App Users",
        is_admin=True,
    )


def test_member_does_not_see_admin_app_tile():
    groups = ["gentian:tenant:demo:members", "gentian:tenant:demo:app:element"]
    assert not user_can_see_portal_tile(
        groups,
        tenant="demo",
        profile="app-store",
        allowed_group="Tenant Admins",
        is_admin=False,
    )


async def test_shell_apps_for_tenant_admin_includes_admin_and_app_store_only():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "admin-demo",
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:admins"],
    }

    def fake_profile(name: str):
        if name == "element":
            return ELEMENT_PROFILE
        if name == "app-store":
            return APP_STORE_PROFILE
        return None

    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", side_effect=fake_profile),
        patch(
            "app.core.shell_apps.is_platform_app",
            side_effect=lambda profile: profile.get("metadata", {})
            .get("annotations", {})
            .get("gentianos.io/platform-app")
            == "true",
        ),
    ):
        apps = await shell_apps_for_user(user, settings)

    assert [app["id"] for app in apps] == ["app-store-app-store", "admin"]
    assert all(app["id"] != "element-element" for app in apps)
    store_app = next(app for app in apps if app["id"] == "app-store-app-store")
    assert store_app["authMode"] is None


async def test_shell_apps_for_member_includes_entitled_app():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:element",
        ],
    }
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", return_value=ELEMENT_PROFILE),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)
    assert apps == [
        {
            "id": "element-element",
            "title": "Chat",
            "icon": "chat",
            "launchUrl": "https://chat.demo.desk.gentian.org",
            "linkTarget": "embedded",
            "authMode": "matrix-bridge",
            "builtin": False,
        }
    ]


async def test_shell_apps_for_openproject_uses_bridge_auth_mode():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:openproject",
        ],
    }
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["openproject"]),
        patch("app.core.shell_apps.get_app_profile", return_value=OPENPROJECT_PROFILE),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)
    assert apps == [
        {
            "id": "openproject-openproject",
            "title": "Projects",
            "icon": "projects",
            "launchUrl": "https://projects.demo.desk.gentian.org",
            "linkTarget": "embedded",
            "authMode": "openproject-bridge",
            "builtin": False,
        }
    ]


async def test_shell_apps_for_nextcloud_uses_bridge_auth_mode():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:nextcloud-office",
        ],
    }
    nextcloud_profile = {
        "metadata": {"name": "nextcloud-office"},
        "spec": {
            "displayName": "Nextcloud Office",
            "ingress": {"subDomain": "cloud"},
            "tile": {"icon": "files"},
            "kernelRequirements": {"identity": {"oidc": {"clientId": "gentian-nextcloud-office"}}},
            "portalTiles": [
                {
                    "name": "nextcloud-office",
                    "displayName": {"en_US": "Files"},
                    "allowedGroup": "App Users",
                    "linkTarget": "embedded",
                }
            ],
        },
    }
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["nextcloud-office"]),
        patch("app.core.shell_apps.get_app_profile", return_value=nextcloud_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)
    assert apps == [
        {
            "id": "nextcloud-office-nextcloud-office",
            "title": "Files",
            "icon": "files",
            "launchUrl": "https://cloud.demo.desk.gentian.org",
            "linkTarget": "embedded",
            "authMode": "nextcloud-bridge",
            "builtin": False,
        }
    ]


async def test_shell_apps_for_member_without_entitlement_empty():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "member-demo",
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:members"],
    }
    element_profile = {
        "metadata": {"name": "element"},
        "spec": {
            "ingress": {"subDomain": "chat"},
            "portalTiles": [
                {
                    "name": "element",
                    "displayName": {"en_US": "Chat"},
                    "allowedGroup": "managed-by-attribute-Livecollaboration",
                }
            ],
        },
    }
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", return_value=element_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)
    assert apps == []


async def test_shell_apps_for_odoo_module_visibility():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "crm-user@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": ["/sales-team"],
    }
    
    crm_profile = {
        "metadata": {
            "name": "odoo-cb-crm",
            "annotations": {"gentianos.io/requires-profile": "odoo-cb-base"},
        },
        "spec": {
            "displayName": "Odoo CRM",
            "portalTiles": [{"name": "crm", "allowedGroup": "App Users"}],
        }
    }
    
    base_profile = {
        "metadata": {"name": "odoo-cb-base"},
        "spec": {
            "ingress": {"subDomain": "erp"},
        }
    }
    
    def fake_profile(name: str):
        if name == "odoo-cb-crm":
            return crm_profile
        if name == "odoo-cb-base":
            return base_profile
        return None
    
    # Mock AdminStore list_groups
    from unittest.mock import AsyncMock
    from app.services.admin_store import Group
    
    mock_store = AsyncMock()
    mock_store.list_groups.return_value = [
        Group(
            id="g1",
            name="sales-team",
            path="/sales-team",
            gentian_odoo_modules=["crm"],
        )
    ]
    
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["odoo-cb-crm"]),
        patch("app.core.shell_apps.get_app_profile", side_effect=fake_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings, store=mock_store)
        
    assert len(apps) == 1
    assert apps[0]["id"] == "odoo-cb-crm-crm"
    assert apps[0]["launchUrl"] == "https://erp.demo.desk.gentian.org"
