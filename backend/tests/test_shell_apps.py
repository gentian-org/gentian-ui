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
    "metadata": {
        "name": "element",
        "annotations": {"gentianos.io/portal-auth-mode": "matrix-bridge"},
    },
    "spec": {
        "displayName": "Element (Matrix)",
        "ingress": {"subDomain": "chat"},
        "tile": {"icon": "chat"},
        "kernelRequirements": {"identity": {"oidc": {"clientId": "gentian-synapse"}}},
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
    "metadata": {
        "name": "openproject",
        "annotations": {"gentianos.io/portal-auth-mode": "openproject-bridge"},
    },
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


ODOO_BASE_PROFILE = {
    "metadata": {"name": "odoo-base-ce"},
    "spec": {
        "family": "odoo",
        "ingress": {"subDomain": "erp"},
        "portalTiles": [
            {"name": "odoo-admin", "allowedGroup": "App Admins", "linkTarget": "embedded"}
        ],
    },
}

ODOO_CRM_PROFILE = {
    "metadata": {
        "name": "odoo-crm-ce",
        "annotations": {"gentianos.io/deployment-role": "addon"},
    },
    "spec": {
        "displayName": "Odoo CRM",
        "family": "odoo",
        "customization": {"addon": {"id": "crm", "of": "odoo-base-ce"}},
        "portalTiles": [{"name": "crm", "allowedGroup": "App Users"}],
    },
}


def _fake_odoo_profile(name: str):
    return {
        "odoo-base-ce": ODOO_BASE_PROFILE,
        "odoo-crm-ce": ODOO_CRM_PROFILE,
    }.get(name)

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
            "preopen": False,
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
            "preopen": False,
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
        "metadata": {
            "name": "nextcloud-office",
            "annotations": {"gentianos.io/portal-auth-mode": "portal-bridge"},
        },
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
            "authMode": "portal-bridge",
            "preopen": False,
            "builtin": False,
        }
    ]


async def test_shell_apps_uses_annotated_portal_auth_mode():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:some-app",
        ],
    }
    custom_profile = {
        "metadata": {
            "name": "some-app",
            "annotations": {"gentianos.io/portal-auth-mode": "custom-bridge"},
        },
        "spec": {
            "displayName": "Custom App",
            "ingress": {"subDomain": "custom"},
            "tile": {"icon": "app"},
            "kernelRequirements": {"identity": {"oidc": {"clientId": "some-client"}}},
            "portalTiles": [
                {
                    "name": "some-app",
                    "displayName": {"en_US": "Custom"},
                    "allowedGroup": "App Users",
                    "linkTarget": "embedded",
                }
            ],
        },
    }
    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["some-app"]),
        patch("app.core.shell_apps.get_app_profile", return_value=custom_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)
    assert len(apps) == 1
    assert apps[0]["authMode"] == "custom-bridge"


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


async def test_addon_tile_needs_that_addons_own_group():
    """Entitlement is the addon's own group -- tenant membership is not enough."""
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False

    def user_with(*groups):
        return {
            "preferred_username": "john-doe@demo.desk.gentian.org",
            "tenant": "demo",
            "groups": list(groups),
        }

    with (
        patch(
            "app.core.shell_apps.list_installed_profiles",
            return_value=["odoo-base-ce", "odoo-crm-ce"],
        ),
        patch("app.core.shell_apps.get_app_profile", side_effect=_fake_odoo_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        entitled = await shell_apps_for_user(
            user_with(
                "gentian:tenant:demo:members",
                "gentian:tenant:demo:app:odoo-base-ce",
                "gentian:tenant:demo:app:odoo-crm-ce",
            ),
            settings,
        )
        member_only = await shell_apps_for_user(
            user_with(
                "gentian:tenant:demo:members",
                "gentian:tenant:demo:app:odoo-base-ce",
            ),
            settings,
        )

    ids = [app["id"] for app in entitled]
    assert "odoo-crm-ce-crm" in ids
    crm = next(app for app in entitled if app["id"] == "odoo-crm-ce-crm")
    assert crm["launchUrl"] == "https://erp.demo.desk.gentian.org"

    # Holding the base and being a tenant member used to be enough for every
    # addon tile in the family.
    assert [app["id"] for app in member_only] == []


async def test_base_tile_hidden_when_no_addon_is_entitled():
    """A base with no entitled addon has nothing to offer, so it stays hidden."""
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            # entitled to the base itself, but to none of the addons in it
            "gentian:tenant:demo:app:odoo-base-ce",
        ],
    }
    with (
        patch(
            "app.core.shell_apps.list_installed_profiles",
            return_value=["odoo-base-ce", "odoo-crm-ce"],
        ),
        patch("app.core.shell_apps.get_app_profile", side_effect=_fake_odoo_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)

    assert [app["id"] for app in apps] == []


async def test_base_tile_shown_once_one_addon_is_entitled():
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:odoo-base-ce",
            "gentian:tenant:demo:app:odoo-crm-ce",
        ],
    }
    with (
        patch(
            "app.core.shell_apps.list_installed_profiles",
            return_value=["odoo-base-ce", "odoo-crm-ce"],
        ),
        patch("app.core.shell_apps.get_app_profile", side_effect=_fake_odoo_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)

    assert "odoo-base-ce-odoo-admin" in [app["id"] for app in apps]


async def test_base_without_activated_addons_is_not_hollow():
    """A base the tenant activated nothing in is a plain app, not a hollow base."""
    settings = Settings(auth_disabled=False, KERNEL_DOMAIN="desk.gentian.org")
    settings.auth_disabled = False
    user = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "tenant": "demo",
        "groups": [
            "gentian:tenant:demo:members",
            "gentian:tenant:demo:app:odoo-base-ce",
        ],
    }
    with (
        patch(
            "app.core.shell_apps.list_installed_profiles",
            return_value=["odoo-base-ce"],
        ),
        patch("app.core.shell_apps.get_app_profile", side_effect=_fake_odoo_profile),
        patch("app.core.shell_apps.is_platform_app", return_value=False),
    ):
        apps = await shell_apps_for_user(user, settings)

    assert [app["id"] for app in apps] == ["odoo-base-ce-odoo-admin"]


# --- capability-gated platform apps -----------------------------------------
#
# platform-app means "show without installing per tenant" — that is how the App
# Store gets a tile. It says nothing about whether the thing behind the tile
# exists, so litellm-me and open-webui were offered on a cluster with LLM off,
# pointing at hosts that resolve to nothing.
#
# The catalogue/installed distinction still holds: the profile stays installable
# and discoverable either way. Only the tile waits for the capability.

LLM_PROFILE = {
    "metadata": {
        "name": "litellm-me",
        "annotations": {
            "gentianos.io/platform-app": "true",
            "gentianos.io/requires-capability": "llm",
        },
    },
    "spec": {"displayName": "LLM Admin Panel"},
}

PLAIN_PLATFORM_PROFILE = {
    "metadata": {"name": "app-store", "annotations": {"gentianos.io/platform-app": "true"}},
    "spec": {"displayName": "App Store"},
}


def test_required_capability_reads_the_annotation():
    from app.services.k8s_catalogue import required_capability

    assert required_capability(LLM_PROFILE) == "llm"
    assert required_capability(PLAIN_PLATFORM_PROFILE) == ""


def test_platform_apps_are_filtered_by_capability():
    from unittest.mock import patch

    from app.services import k8s_catalogue

    listed = {"items": [PLAIN_PLATFORM_PROFILE, LLM_PROFILE]}
    with patch.object(
        k8s_catalogue, "_custom_objects_api"
    ) as api:
        api.return_value.list_cluster_custom_object.return_value = listed

        # LLM off: the gated tile is withheld, the ungated one is not.
        assert k8s_catalogue.list_platform_app_profiles(set()) == ["app-store"]

        # LLM on: both appear.
        assert k8s_catalogue.list_platform_app_profiles({"llm"}) == ["app-store", "litellm-me"]

        # No capability set supplied at all behaves as "none known", which is the
        # safe default: a tile for something undeployed is worse than a missing one.
        assert k8s_catalogue.list_platform_app_profiles() == ["app-store"]


def test_capability_set_parses_the_setting():
    from app.core.config import Settings

    assert Settings(GENTIAN_CAPABILITIES="").capability_set == set()
    assert Settings(GENTIAN_CAPABILITIES="llm").capability_set == {"llm"}
    assert Settings(GENTIAN_CAPABILITIES="llm, mail ,").capability_set == {"llm", "mail"}
