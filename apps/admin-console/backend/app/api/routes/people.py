"""People, groups and the realm's password policy.

Every one of these is relayed to the director with the caller's own token.
This component holds no Keycloak credential and never has: the director holds
one per realm, and what a caller may do with it is decided by OpenFGA against
their token before the director touches anything.

That is the reversal S7A.17 makes, and it is worth stating plainly because the
screen it replaces said the opposite. People used to be managed in Keycloak's
own console, on the argument that a console holding an administrator
credential is a large thing to get wrong. The argument was right; the
conclusion was not. The credential moves to the one component that already
asks who is calling, rather than the screens moving to a console built for
realm engineers.

The writes are ACTIONS, not commits. Inviting somebody happens once and leaves
no declared state; people do not belong in an append-only history, which is the
whole reason they are not in git. The director spells that in the route
(`/actions/...`) and this module keeps the distinction visible rather than
flattening it into a REST-shaped PUT.
"""

from fastapi import APIRouter, Body, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["people"])
_bearer = HTTPBearer(auto_error=False)


def _tenant(settings: Settings, tenant: str | None) -> str:
    return tenant or settings.tenant_id


def _fields(payload: dict, names: tuple[str, ...]) -> dict:
    """The named fields the caller sent, and nothing else.

    Only the ones present: an edit that did not mention a field leaves it as it
    is, and relaying a default in its place would change it.
    """
    return {k: payload[k] for k in names if k in payload}


async def _action(
    settings: Settings,
    tenant: str | None,
    credentials: HTTPAuthorizationCredentials | None,
    action: str,
    body: dict,
) -> Response:
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/{action}",
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/people")
async def people(
    tenant: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=200),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who is in this tenant.

    `pending` is the field worth reading: somebody invited who has not set a
    password or verified their address is not yet a person who can sign in,
    and a list that showed them the same as everybody else would make a failed
    invitation invisible.
    """
    params: dict[str, str] = {}
    if search:
        params["search"] = search
    if limit:
        params["limit"] = str(limit)
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/people",
        bearer_of(credentials),
        params=params or None,
    )


@router.get("/people/{person_id}")
async def person(
    person_id: str,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """One person and the groups they hold, within this tenant's scope."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/people/{person_id}",
        bearer_of(credentials),
    )


@router.get("/groups")
async def groups(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The groups this tenant may put somebody in.

    A tenant with its own realm sees its realm's groups. A tenant that shares
    the kernel realm sees only its own subtree — the director filters, because
    in a shared realm the credential is no longer the boundary.
    """
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/groups",
        bearer_of(credentials),
    )


@router.get("/identity")
async def identity_settings(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The realm's settings a tenant administrator may see.

    The password policy today, in Keycloak's own spelling. Passed through
    unparsed: the platform does not interpret it, and a parse here would have
    to be kept in step with a vocabulary Keycloak extends.
    """
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/identity",
        bearer_of(credentials),
    )


@router.post("/people/invite")
async def invite(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Invite somebody by address.

    202 with `mailed: true` is the whole thing done. 202 with `mailed: false`
    means the person exists and the link did not go — the repair is to
    re-send, not to invite again, and the answer says so rather than reading
    as a failure that left nothing behind.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/invite-person",
        bearer_of(credentials),
        json_body=_fields(
            payload,
            (
                "email",
                "username",
                "firstName",
                "lastName",
                "requireTotp",
                "settingsTemplate",
                "groups",
            ),
        ),
    )


@router.post("/people/membership")
async def set_membership(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Add or remove one person from one group.

    `member` is required and not defaulted. A request that did not say which
    way is ambiguous, and choosing for the caller is a change nobody asked
    for.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/set-membership",
        bearer_of(credentials),
        json_body={
            "person": payload.get("person", ""),
            "group": payload.get("group", ""),
            "member": payload.get("member"),
        },
    )


@router.post("/identity/password-policy")
async def set_password_policy(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Set the realm's password policy.

    A different relation from the rest of this module: can_set_policy rather
    than can_manage_users, because this is a statement about the tenant rather
    than about a person. The director decides that; this only relays.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/set-password-policy",
        bearer_of(credentials),
        json_body={"passwordPolicy": payload.get("passwordPolicy")},
    )


# Editing somebody, and the groups and templates the member screens use. Each
# is the director's action of the same name; the fields relayed are listed so
# nothing else a caller sends travels on.


@router.post("/people/update")
async def update_person(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Names, delivery address, and whether they may sign in."""
    return await _action(
        settings,
        tenant,
        credentials,
        "update-person",
        _fields(payload, ("person", "firstName", "lastName", "enabled", "email")),
    )


@router.post("/people/remove")
async def remove_person(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Remove somebody. The director refuses it for the caller themselves."""
    return await _action(
        settings, tenant, credentials, "remove-person", _fields(payload, ("person",))
    )


@router.post("/people/reset-password")
async def reset_password(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Mail somebody a link to set a new password."""
    return await _action(
        settings, tenant, credentials, "send-password-reset", _fields(payload, ("person",))
    )


@router.post("/people/require-totp")
async def require_totp(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Require an authenticator at the next sign-in; `mail` sends the link now."""
    return await _action(
        settings, tenant, credentials, "require-totp", _fields(payload, ("person", "mail"))
    )


@router.post("/people/remove-totp")
async def remove_totp(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Delete somebody's authenticators, for a lost device."""
    return await _action(
        settings, tenant, credentials, "remove-totp", _fields(payload, ("person",))
    )


@router.post("/groups/create")
async def create_group(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Make a custom group; the director places it in the tenant's subtree."""
    return await _action(settings, tenant, credentials, "create-group", _fields(payload, ("name",)))


@router.post("/groups/delete")
async def delete_group(
    payload: dict = Body(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Delete a custom group. The platform's own groups are refused."""
    return await _action(
        settings, tenant, credentials, "delete-group", _fields(payload, ("group",))
    )


@router.get("/groups/members")
async def group_members(
    group: str = Query(...),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who is in one group."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/group-members",
        bearer_of(credentials),
        params={"group": group},
    )


@router.get("/templates")
async def templates(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The desktop's settings templates an invitation may apply."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/templates",
        bearer_of(credentials),
    )
