"""Tests for shell launcher app resolution."""

from unittest.mock import patch

from app.core.config import Settings
from app.core.shell_apps import (
    app_launch_url,
    shell_apps_for_user,
    user_can_see_portal_tile,
)


def test_app_launch_url_uses_tenant_subdomain():
    spec = {"ingress": {"subDomain": "chat"}}
    assert (
        app_launch_url(spec, tenant="demo", kernel_domain="desk.gentian.org")
        == "https://chat.demo.desk.gentian.org"
    )


def test_user_can_see_portal_tile_with_app_entitlement():
    groups = ["gentian:tenant:demo:app:element"]
    assert user_can_see_portal_tile(
        groups,
        tenant="demo",
        profile="element",
        allowed_group="App Users",
        is_admin=False,
    )


def test_shell_apps_for_tenant_admin_includes_admin_tile():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    user = {
        "preferred_username": "admin-demo",
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:admins"],
    }
    element_profile = {
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
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", return_value=element_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = shell_apps_for_user(user, settings)
    assert apps[-1]["id"] == "admin"
    assert any(app["id"] == "element-element" for app in apps)


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
    element_profile = {
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
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", return_value=element_profile),
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
            "authMode": "oidc",
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
