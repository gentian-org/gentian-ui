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


def test_app_launch_url_uses_tenant_subdomain():
    spec = {"ingress": {"subDomain": "chat"}}
    assert (
        app_launch_url(spec, tenant="demo", kernel_domain="desk.gentian.org")
        == "https://chat.demo.desk.gentian.org"
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


def test_shell_apps_for_tenant_admin_includes_admin_and_app_store_only():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
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
        apps = shell_apps_for_user(user, settings)

    assert [app["id"] for app in apps] == ["app-store-app-store", "admin"]
    assert all(app["id"] != "element-element" for app in apps)


def test_shell_apps_for_member_includes_entitled_app():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
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
        apps = shell_apps_for_user(user, settings)
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


def test_shell_apps_for_member_without_entitlement_empty():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
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
        apps = shell_apps_for_user(user, settings)
    assert apps == []
