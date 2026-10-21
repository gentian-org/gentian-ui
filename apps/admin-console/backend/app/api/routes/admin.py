# SPDX-License-Identifier: Apache-2.0
"""The console's own context, and an honest answer for every screen that is
not yet a client of the director.

Context
-------
Which screens exist for this person is decided from two answers of the
director: the tenant's verbs, asked on the tenant this console runs in, and
the cluster's verbs. Nothing here reads a group out of a token. The tenant is
the one the platform put this component in, which is the only tenant this
console administers; a platform administrator reaching into another tenant
does so through that tenant's own console, never through this process.

Screens not yet mapped
----------------------
The console was carved out of the desktop, where its screens reached Keycloak
and Kubernetes through the desktop's backend with credentials this component
must not hold. Each screen is being re-pointed at the director one at a time.
Until a screen's director endpoints exist, the route it calls is answered 501
with a message naming the screen, so the console shows exactly that rather
than a spinner or a fabricated empty state. The table below is the list of
what is left; a screen leaves it by getting a real route above it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["admin"])
_bearer = HTTPBearer(auto_error=False)


class AdminContextResponse(BaseModel):
    tenant: str
    realm: str
    isPlatformAdmin: bool
    # Whether this person administers the tenant. False only for the
    # security officer let in for the Approvals screen (see admin_context).
    isTenantAdmin: bool
    availableTenants: list[str]
    kernelDomain: str
    # The director's answer to whether this person may put something of this
    # tenant on the internet or take it off (can_expose). It decides which
    # buttons the Apps screen offers and nothing else: the director asks again
    # on every approval and withdrawal.
    canExpose: bool = False
    # The director's answer to whether this person may say what one app of
    # this tenant may consume from another (can_grant). It decides whether
    # the Integrations screen offers approving and withdrawing; the director
    # asks again on every write.
    canGrant: bool = False
    # The director's answer to whether this person may answer an app's egress
    # request (can_approve_privilege). It decides whether the Apps screen
    # offers approving; the director asks again on every approval, and
    # decides a podSecurity or clusterRoles request by another right.
    canApprovePrivilege: bool = False
    # The director's answer to whether this person may answer the requests
    # that weaken what protects the node -- podSecurity, clusterRoles, every
    # kind that is not egress (cluster#can_approve, the security officer's).
    # Which kind needs which is the operator's answer on each pending request
    # (pendingPrivilegeApprovals), not decided here; the director asks again
    # on every approval.
    canApproveNodePrivilege: bool = False
    # Kept for the screens that read it. People are managed in Keycloak's own
    # console, which this component links to; it holds no store of its own.
    storeConfigured: bool = True


async def _relations(settings: Settings, path: str, token: str) -> dict[str, bool]:
    answer = await director.forward(settings, "GET", path, token)
    if answer.status_code != 200:
        raise HTTPException(
            status_code=answer.status_code, detail=answer.body.decode() or "the director refused"
        )
    import json

    body = json.loads(answer.body)
    relations = body.get("relations") or {}
    return {k: bool(v) for k, v in relations.items()}


@router.get("/context", response_model=AdminContextResponse)
async def admin_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AdminContextResponse:
    token = bearer_of(credentials)
    tenant = settings.tenant_id
    tenant_rel = await _relations(settings, f"/v1/tenants/{tenant}/me", token)
    cluster_rel = await _relations(settings, f"/v1/clusters/{director.cluster(settings)}/me", token)
    administers = bool(tenant_rel.get("can_administer"))
    if not administers and not cluster_rel.get("can_approve"):
        # The edge let this person in, which needs only can_enter. The console
        # needs more, and says so as the refusal it is.
        #
        # The one widening: the cluster's security officer (can_approve) is
        # let in without administering the tenant, to see the Approvals
        # screen and nothing else of it -- isTenantAdmin false, and the
        # director refuses them every other read and write all the same.
        raise HTTPException(status_code=403, detail="Tenant administrator privileges required")
    return AdminContextResponse(
        tenant=tenant,
        realm=settings.kernel_realm or tenant,
        isPlatformAdmin=administers and bool(cluster_rel.get("can_configure")),
        isTenantAdmin=administers,
        availableTenants=[tenant],
        kernelDomain=settings.kernel_domain or "",
        canExpose=bool(tenant_rel.get("can_expose")),
        canGrant=bool(tenant_rel.get("can_grant")),
        canApprovePrivilege=bool(tenant_rel.get("can_approve_privilege")),
        canApproveNodePrivilege=bool(cluster_rel.get("can_approve")),
    )


@router.get("/apps/status")
async def app_states(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What the cluster holds of this tenant's components, from the operator
    through the usher: whether each is Ready and why not. The Apps screen
    joins it with what git declares (routes/apps.py), and the Export tab reads
    it to learn whether the Operations Console is installed."""
    return await director.read(
        settings, f"/v1/tenants/{settings.tenant_id}/apps/status", bearer_of(credentials)
    )


# Every route a not-yet-mapped screen calls, and the screen it belongs to.
# Method and path prefix, matched in order. This is the worklist of the
# re-pointing, kept where the code is so it cannot drift from what the
# console actually serves.
NOT_YET_MAPPED: list[tuple[str, str, str]] = [
    # One thing is left, and it is here for a reason rather than for want of
    # time.
    #
    # Sign-ins, refused requests and reads of data leave no commit. They need
    # stores that do not exist yet -- see gentian-os docs/roadmap.md 1.12,
    # which is a researched plan rather than a gap.
    ("GET", "/admin/audit-events", "Audit"),
    # GROUPS ARE NO LONGER HERE. The entry said a group-scoped notification
    # audience waited for the group list to have an owner; it has one now --
    # the director reads it through its per-realm Keycloak credential, and
    # people.py serves it before this catch-all is reached. What is still
    # missing for that screen is narrower and belongs to the notify action
    # rather than to the list: POST /actions/notify takes a tenant audience
    # and no group. An entry that outlived its reason is worse than none.
]


def screen_for(method: str, path: str) -> str | None:
    for m, prefix, screen in NOT_YET_MAPPED:
        if m == method and (path == prefix or path.startswith((prefix + "/", prefix + "?"))):
            return screen
    return None


# The catch-all, and so the LAST route of this router: routes are matched in
# the order they are declared, and one declared below this is never reached.
@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def not_yet_mapped(
    rest: str, request: Request, _user: dict = Depends(get_current_user)
) -> None:
    path = "/admin/" + rest
    screen = screen_for(request.method, path)
    if screen is None:
        raise HTTPException(status_code=404, detail="No such route.")
    raise HTTPException(
        status_code=501,
        detail=f"The {screen} screen is not yet a client of the director. "
        "It is being re-pointed from the desktop's backend, and until its director endpoints exist it cannot show anything.",
    )
