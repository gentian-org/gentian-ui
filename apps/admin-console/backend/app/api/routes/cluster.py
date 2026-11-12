"""The cluster, as the director answers for it.

Every route here relays to the gentian-os director as the caller and hands
back whatever it answers, unchanged. The console holds no credential, keeps
no state, and decides nothing: whether this person may list tenants, change
a setting or open a console is the director's answer, read from the
authorization graph, and a refusal comes back as the refusal it is.
"""

from fastapi import APIRouter, Depends, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/cluster", tags=["cluster"])
_bearer = HTTPBearer(auto_error=False)


def _cluster_path(settings: Settings, suffix: str) -> str:
    return f"/v1/clusters/{director.cluster(settings)}{suffix}"


@router.get("/me")
async def cluster_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Which of the cluster's verbs this person holds. Every verb false is an
    ordinary answer: it is what almost everyone who signs in gets. The
    usher answers it."""
    return await director.read(settings, _cluster_path(settings, "/me"), bearer_of(credentials))


@router.get("/settings")
async def cluster_settings(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What this cluster is configured with, catalog and values together, so
    the screen renders from one answer and holds no catalog of its own."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/settings"), bearer_of(credentials)
    )


@router.get("/updates")
async def updates(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Which installed apps, in every tenant, are behind the build their
    catalog offers, and what keeps them there: the director's report, read
    under `can_audit` on the cluster. The policy and whether its window is
    open now come with it."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/updates"), bearer_of(credentials)
    )


@router.get("/release")
async def release(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The platform release this cluster runs (gentian-os
    docs/concepts/versioning.md §2.1): what the Cluster claim declares, what
    the operator applied and what the release index offers under the
    cluster's autoUpgrade mode, with the maintenance window. The director's
    answer, read under `can_audit` on the cluster."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/release"), bearer_of(credentials)
    )


@router.post("/release")
async def set_release(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Move the cluster to a release ({"version": "vX.Y.Z", "autoUpgrade":
    "none|patch|minor"}) or onto a branch ({"track": "<branch>"}). The cluster
    administrator's act (`can_configure`): the director writes spec.release
    and the catalog source as one signed commit, and the operator moves the
    cluster from there."""
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, "/actions/set-release"),
        bearer_of(credentials),
        json_body=body,
    )


@router.post("/updates/move")
async def move_outdated(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Move every outdated app -- or those of the tenants and apps the body
    names -- to the newest build its catalog offers. The cluster
    administrator's act (`can_configure`); each move exports first, verifies
    after and rolls back by itself, and the report says how each went."""
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, "/actions/move-outdated"),
        bearer_of(credentials),
        json_body=body,
    )


@router.put("/tenants/{tenant}/apps/{profile}/update-mode")
async def set_update_mode(
    tenant: str,
    profile: str,
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """How one tenant's app moves to newer builds: `{"mode": "latest" |
    "manual" | "tenant" | ""}`, "" removing the override so the cluster's
    policy applies again. The cluster administrator's write."""
    return await director.forward(
        settings,
        "PUT",
        _cluster_path(settings, f"/tenants/{tenant}/apps/{profile}/update-mode"),
        bearer_of(credentials),
        json_body=body,
    )


@router.patch("/settings")
async def set_cluster_settings(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """One request is one commit. 202 with a commit means git has it and the
    cluster does not yet; 200 means the state asked for already held."""
    return await director.forward(
        settings,
        "PATCH",
        _cluster_path(settings, "/settings"),
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/models")
async def cluster_models(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The models the Cluster claim declares for the gateway, and what the
    claim alone says about each: the director's answer, read from git. Neither
    the gateway nor the vault is asked, here or there."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/models"), bearer_of(credentials)
    )


@router.put("/models")
async def set_cluster_models(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The whole of the model settings, as one commit by the director. It
    holds the body to the claim's schema and refuses any field the settings
    have none of -- a provider's token among them, which is a credential and
    is entered on the credentials screen."""
    return await director.forward(
        settings,
        "PUT",
        _cluster_path(settings, "/models"),
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/tenants/{tenant}/model-access")
async def tenant_model_access(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What one tenant's apps may use at the model gateway: the providers it
    opts in to, its budget, whether its administrators may change the
    providers, and each of the cluster's models with whether the tenant may
    use it. The cluster's auditor and the tenant's administrator may read it;
    the director decides which."""
    return await director.forward(
        settings,
        "GET",
        _cluster_path(settings, f"/tenants/{tenant}/model-access"),
        bearer_of(credentials),
    )


@router.put("/tenants/{tenant}/model-access")
async def set_tenant_model_access(
    tenant: str,
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The whole of the tenant's model access, as one commit by the director.

    Sent as it came: a tenant's administrator sends the budget and the
    delegation back as they were read, and the director refuses a body that
    changes them (403). Nothing is filled in or dropped here, because a
    budget this relay left out would be a budget removed."""
    return await director.forward(
        settings,
        "PUT",
        _cluster_path(settings, f"/tenants/{tenant}/model-access"),
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/tenants")
async def cluster_tenants(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/tenants"), bearer_of(credentials)
    )


@router.post("/tenants")
async def create_cluster_tenant(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, "/tenants"),
        bearer_of(credentials),
        json_body=body,
    )


@router.delete("/tenants/{tenant}")
async def retire_cluster_tenant(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings, "DELETE", _cluster_path(settings, f"/tenants/{tenant}"), bearer_of(credentials)
    )


@router.post("/tenants/{tenant}/purge")
async def purge_cluster_tenant(
    tenant: str,
    body: dict | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Retire a tenant and delete its data.

    The director commits deletionPolicy: Delete first and removes the tenant
    once the cluster holds it, so the answer is the first commit; the tenant
    is listed as purging until the second lands. keepBundles is the one
    option relayed: it spares the backup bucket.
    """
    payload = {"keepBundles": True} if body and body.get("keepBundles") else {}
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, f"/tenants/{tenant}/actions/purge"),
        bearer_of(credentials),
        json_body=payload,
    )


@router.post("/tenants/{tenant}/activate-admin")
async def activate_tenant_admin(
    tenant: str,
    body: dict | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Hand a tenant's administrator account to its holder.

    The account has no password. The registrar issues a single-use link that
    sets one (and a second factor unless the tenant opts out): mailed to the
    recovery address when one is given, otherwise returned to show once.
    """
    payload = {}
    if body and body.get("recoveryEmail"):
        payload["recoveryEmail"] = body["recoveryEmail"]
    return await director.forward_to(
        director.registrar_url(settings),
        "POST",
        _cluster_path(settings, f"/tenants/{tenant}/actions/activate-admin"),
        bearer_of(credentials),
        json_body=payload,
    )


@router.post("/tenants/{tenant}/admin-invitation")
async def request_admin_invitation(
    tenant: str,
    body: dict | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Ask for a tenant's administrator to be invited once the tenant is ready.

    A new tenant takes minutes to exist, and its administrator cannot be
    activated before it does. The registrar keeps the request, with the
    address, and sends the invitation itself, so nobody has to keep a page
    open. The console keeps nothing: the address goes to the registrar with
    the person's own token and is not held here.
    """
    payload = {}
    if body and body.get("recoveryEmail"):
        payload["recoveryEmail"] = body["recoveryEmail"]
    return await director.forward_to(
        director.registrar_url(settings),
        "POST",
        _cluster_path(settings, f"/tenants/{tenant}/actions/request-admin-invitation"),
        bearer_of(credentials),
        json_body=payload,
    )


@router.get("/tenants/{tenant}/admin-invitation")
async def admin_invitation(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What became of a tenant's invitation: pending, sent, expired, not
    mailed. The registrar answers the state and never the address."""
    return await director.forward_to(
        director.registrar_url(settings),
        "GET",
        _cluster_path(settings, f"/tenants/{tenant}/admin-invitation"),
        bearer_of(credentials),
    )


@router.get("/admin-invitations")
async def pending_admin_invitations(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tenants whose administrator's invitation is waiting."""
    return await director.forward_to(
        director.registrar_url(settings),
        "GET",
        _cluster_path(settings, "/admin-invitations"),
        bearer_of(credentials),
    )


# --- The cluster roles held by name (iam.md 1.1c) ----------------------------
#
# Who holds a cluster role by name is declared on the Cluster claim: an
# account of a tenant's realm, by its subject there, with a reason and an
# optional expiry. The holder signs in to their own tenant. The director
# commits the choice (can_configure) and answers who holds what (can_audit);
# the registrar answers who could: the platform tenant's people and every
# other tenant's administrators. The console relays both as the caller and
# decides nothing.


@router.get("/role-holders")
async def role_holders(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who holds which cluster role, as the claim declares it."""
    return await director.forward(
        settings,
        "GET",
        _cluster_path(settings, "/platform-roles/holders"),
        bearer_of(credentials),
    )


@router.put("/role-holders/{role}/{tenant}/{subject}")
async def set_role_holder(
    role: str,
    tenant: str,
    subject: str,
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """An account of a tenant's realm holds the role: one commit to the
    claim. The body carries the login, the address shown for it, the
    reason and an optional expiry."""
    return await director.forward(
        settings,
        "PUT",
        _cluster_path(settings, f"/platform-roles/holders/{role}/{tenant}/{subject}"),
        bearer_of(credentials),
        json_body=body,
    )


@router.delete("/role-holders/{role}/{tenant}/{subject}")
async def remove_role_holder(
    role: str,
    tenant: str,
    subject: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """No longer: the entry goes, and with it the tuple."""
    return await director.forward(
        settings,
        "DELETE",
        _cluster_path(settings, f"/platform-roles/holders/{role}/{tenant}/{subject}"),
        bearer_of(credentials),
    )


@router.get("/role-candidates")
async def role_candidates(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who could hold it: the platform tenant's people and every other
    tenant's administrators, read by the registrar from each tenant's realm,
    under can_configure on the cluster."""
    return await director.forward_to(
        director.registrar_url(settings),
        "GET",
        _cluster_path(settings, "/role-candidates"),
        bearer_of(credentials),
    )


@router.get("/platform-role-members")
async def platform_role_members(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who holds each cluster role through its kernel Keycloak group, read by
    the registrar under can_audit on the cluster. Read only: the groups are
    managed in Keycloak."""
    return await director.forward_to(
        director.registrar_url(settings),
        "GET",
        _cluster_path(settings, "/platform-role-members"),
        bearer_of(credentials),
    )


@router.get("/privileges")
async def granted_privileges(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Every tenant's approved privilege exceptions in one list, as git has
    them: the director's answer under can_audit on the cluster."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/privileges"), bearer_of(credentials)
    )
