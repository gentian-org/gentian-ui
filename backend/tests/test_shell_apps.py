"""Tests for shell launcher app resolution."""

from unittest.mock import patch

import pytest

from app.core.config import Settings
from app.core.shell_apps import (
    app_launch_url,
    is_admin_portal_tile,
    shell_apps_for_user,
    user_can_see_portal_tile,
)


@pytest.fixture(autouse=True)
def platform_profiles():
    """Platform-app tiles come from the cluster's AppProfiles, which these tests
    do not have -- unmocked, every shell_apps_for_user case died in the k8s
    client. The tile sets under test are the tenant's own, so the platform list
    is empty unless a test sets a return value on this fixture.
    """
    with patch("app.core.shell_apps.list_platform_app_profiles", return_value=[]) as listed:
        yield listed


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


async def test_shell_apps_for_tenant_admin_includes_admin_and_app_store_only(platform_profiles):
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

    platform_profiles.return_value = ["app-store"]

    with (
        patch("app.core.shell_apps.list_installed_profiles", return_value=["element"]),
        patch("app.core.shell_apps.get_app_profile", side_effect=fake_profile),
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


# --- kernel service consoles -------------------------------------------------
#
# The regression these cover: a platform administrator signed in at the kernel
# domain got only the built-in Admin Console. tenant_shell_apps returns early
# for a kernel-domain user and every other tile came from there, so the
# cluster's own service consoles had no tile surface at all.
#
# AUTH_DISABLED is passed under its alias, not as auth_disabled=False. The field
# is declared Field(alias="AUTH_DISABLED") with no populate_by_name, so the snake
# case keyword does not bind and conftest's os.environ["AUTH_DISABLED"]="true"
# wins -- which would make every user a platform administrator and pass these
# tests for the wrong reason.


def _kernel_settings(capabilities: str = "llm"):
    return Settings(
        AUTH_DISABLED="false",
        KERNEL_DOMAIN="desk.gentian.org",
        GENTIAN_CAPABILITIES=capabilities,
    )


def _platform_admin_user():
    return {
        "preferred_username": "administrator",
        "tenant": "desk.gentian.org",
        "groups": ["gentian:platform:superadmin"],
    }


@pytest.fixture
def no_installed_profiles():
    """These cases are about kernel tiles, not the tenant's own.

    Unpatched, list_installed_profiles reads AppProfiles from whatever cluster
    the developer's kubeconfig points at, so the assertions would depend on a
    live cluster's tenant.
    """
    with patch("app.core.shell_apps.list_installed_profiles", return_value=[]):
        yield


@pytest.mark.asyncio
async def test_platform_admin_gets_llm_gateway_tile_at_kernel_domain(no_installed_profiles):
    apps = await shell_apps_for_user(_platform_admin_user(), _kernel_settings())
    by_id = {a["id"]: a for a in apps}
    assert "kernel-llm-gateway" in by_id, "no LLM Gateway tile for the cluster admin"
    tile = by_id["kernel-llm-gateway"]
    # The host the kernel HTTPRoute actually serves (kernel_gateway_routes.go),
    # and the admin console on it. LiteLLM serves its API landing page at / and
    # the dashboard at /ui/, so the bare host is the wrong page -- with the
    # trailing slash, because /ui answers 307 to /ui/.
    assert tile["launchUrl"] == "https://llm.desk.gentian.org/ui/"
    assert tile["linkTarget"] == "newwindow"
    # Decorating this URL with a login_hint would be wrong: LiteLLM authenticates
    # through its own SSO path, not a query parameter on its root.
    assert tile["authMode"] is None
    # The built-in console is still there; this tile is in addition to it.
    assert "admin" in by_id


@pytest.mark.asyncio
async def test_no_llm_gateway_tile_without_the_capability(no_installed_profiles):
    """The cluster serves no LLM, so the tile would point at a dead host.

    This is also the state every cluster was in while the portal Application
    failed to pass llm.enabled through -- indistinguishable, from here, from a
    cluster that genuinely has LLM off.
    """
    apps = await shell_apps_for_user(_platform_admin_user(), _kernel_settings(capabilities=""))
    assert not [a for a in apps if a["id"] == "kernel-llm-gateway"]


@pytest.mark.asyncio
async def test_tenant_admin_does_not_get_kernel_consoles(no_installed_profiles):
    """A tenant administrator administers a tenant.

    LiteLLM's console holds the model routing and budgets that apply to every
    tenant on the cluster, so it is not a tenant administrator's to open.
    """
    user = {
        "preferred_username": "alice",
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:admins"],
    }
    apps = await shell_apps_for_user(user, _kernel_settings())
    assert not [a for a in apps if a["id"] == "kernel-llm-gateway"]


@pytest.mark.asyncio
async def test_member_does_not_get_kernel_consoles(no_installed_profiles):
    user = {
        "preferred_username": "bob",
        "tenant": "demo",
        "groups": ["gentian:tenant:demo:members"],
    }
    apps = await shell_apps_for_user(user, _kernel_settings())
    assert not [a for a in apps if a["id"] == "kernel-llm-gateway"]


@pytest.mark.asyncio
async def test_platform_admin_gets_the_three_kernel_consoles(no_installed_profiles):
    """Deployments, Cluster and Identity, on the hosts the kernel routes serve.

    These are what the cluster administrator's desktop is for: each opens on
    the console itself, carried by the Keycloak session the portal already
    holds, rather than on a login form or a token prompt.
    """
    settings = _kernel_settings("gitops,cluster-view,identity")
    apps = await shell_apps_for_user(_platform_admin_user(), settings)
    by_id = {a["id"]: a for a in apps}
    assert by_id["kernel-gitops"]["launchUrl"] == "https://argocd.desk.gentian.org/applications"
    assert by_id["kernel-cluster"]["launchUrl"] == "https://headlamp.desk.gentian.org/"
    # The realm is a setting, and a console URL naming the wrong one lands on a
    # permission error that reads like a login failure.
    assert (
        by_id["kernel-identity"]["launchUrl"]
        == "https://id.desk.gentian.org/auth/admin/kernel/console/"
    )


@pytest.mark.asyncio
async def test_a_console_the_cluster_does_not_run_has_no_tile(no_installed_profiles):
    """A tile pointing at a host that resolves to nothing is worse than no tile."""
    apps = await shell_apps_for_user(_platform_admin_user(), _kernel_settings("gitops"))
    ids = {a["id"] for a in apps}
    assert "kernel-gitops" in ids
    assert "kernel-cluster" not in ids
    assert "kernel-identity" not in ids
