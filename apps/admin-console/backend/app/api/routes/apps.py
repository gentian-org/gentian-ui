"""The tenant's installed apps: what git declares of them, and what is done to one.

Administering an app is this console's. The desktop shows what a person may
open and opens it; nothing there installs, removes or grants. Nothing here
installs either: an app arrives from the App Store, or by command where a
cluster has none. What this screen does is look after the ones that are there.

Every route is a relay for the tenant this console runs in. The person's own
token goes to the director, which asks whether they may, and its status and
body come back as they are -- a refusal included. This module decides nothing
about who may do what.

What the cluster has made of the apps -- running or not, and why -- is the
usher's to answer and is read beside this (`/admin/apps/status`, in admin.py).
The two are joined on the screen, and where they disagree the screen says so.
"""

import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin/apps", tags=["apps"])
_bearer = HTTPBearer(auto_error=False)

# An app's name as the director accepts it. Checked here because it lands in a
# URL path: a name with a dot-dot in it would address a different route of the
# director than the one written below. Not an authorisation check.
_NAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

# A purge is one request, answered when it is over: the operator gives itself
# four and a half minutes and the director waits five for it. This relay waits
# longer than both, so what arrives is always the director's own answer -- done,
# stopped and saying where, or its 504 -- and never this relay giving up first.
PURGE_TIMEOUT_SECONDS = 330.0
_PURGE_TIMEOUT = httpx.Timeout(15.0, read=PURGE_TIMEOUT_SECONDS)


def _name(value: str) -> str:
    if not _NAME.match(value):
        raise HTTPException(status_code=400, detail="That is not a valid app name.")
    return value


@router.get("")
async def declared(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What git says this tenant has installed: each app's pinned build, its
    add-ons, and whether it is installed for everyone."""
    return await director.forward(
        settings, "GET", f"/v1/tenants/{settings.tenant_id}/apps", bearer_of(credentials)
    )


@router.get("/privileges")
async def privileges(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What has been approved for this tenant's apps beyond the default
    posture, by whom and why. A read; approving is not done from here."""
    return await director.forward(
        settings, "GET", f"/v1/tenants/{settings.tenant_id}/privileges", bearer_of(credentials)
    )


@router.get("/retained")
async def retained(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The apps this tenant no longer has installed that still hold data, and
    which kinds of data each one holds. The cluster's answer, through the
    usher; it is what a purge of each app would destroy."""
    return await director.read(
        settings, f"/v1/tenants/{settings.tenant_id}/apps/retained", bearer_of(credentials)
    )


@router.get("/{profile}/residue")
async def residue(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What newer builds of one app left behind on the cluster: the pieces its
    bundle, or an add-on's, brought once and brings no longer.

    The cluster's answer, through the usher, for an app this console's tenant
    has; it is not found for any other. The answer says who may remove the
    pieces (`removableBy`), and the screen follows it: this module decides
    nothing about that.
    """
    return await director.read(
        settings,
        f"/v1/tenants/{settings.tenant_id}/apps/{_name(profile)}/residue",
        bearer_of(credentials),
    )


class ResidueRemoval(BaseModel):
    """One piece, named. `confirm` is the name typed again; without it the
    director answers 428 and says what to type, and that answer is passed on
    like any other."""

    kind: str
    name: str
    namespace: str | None = None
    confirm: str | None = None


@router.post("/{profile}/residue/remove")
async def remove_residue(
    profile: str,
    body: ResidueRemoval,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Delete one piece a newer build of an app left on the cluster. An
    action, not a commit, and not undone.

    The director's action for this console's tenant and this app. It refuses
    on a cluster that carries more than one user tenant (403: the pieces are
    every tenant's), and the cluster deletes only a piece that is on its list
    for this app at that moment (409 with the reason otherwise). Every answer
    arrives as it is; only what was given travels, so an absent namespace or
    confirmation stays absent.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{settings.tenant_id}/apps/{_name(profile)}/actions/remove-residue",
        bearer_of(credentials),
        json_body=body.model_dump(exclude_none=True),
    )


class AccessBody(BaseModel):
    """Whether the app is for everyone. Required: a request that did not say
    which way is not one to guess at."""

    everyone: bool


@router.put("/{profile}/access")
async def set_access(
    profile: str,
    body: AccessBody,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """State whether an installed app is for everyone.

    The director's install route, with `defaultGrant` and nothing else. No
    coordinate and no digest travel, so nothing is fetched and the entry's
    pinned build stays as it is: on an app the tenant has, this changes the
    one key. It answers `updated` with a commit, or `already_installed` when
    the entry already said so.

    The same request for an app the tenant does NOT have would install it,
    because that is what the route is. The screen offers this only for an app
    git declares; whether the person may is the director's (can_install_app,
    and can_grant to make it for everyone).
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{settings.tenant_id}/apps/{_name(profile)}",
        bearer_of(credentials),
        json_body={"defaultGrant": body.everyone},
    )


@router.delete("/{profile}")
async def uninstall(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Take one app out of this console's tenant. A commit: the app and its
    sign-in client go; its files, database, object storage, stored credentials
    and access group are kept, and a later install finds them again."""
    return await director.forward(
        settings,
        "DELETE",
        f"/v1/tenants/{settings.tenant_id}/apps/{_name(profile)}",
        bearer_of(credentials),
    )


class PurgeBody(BaseModel):
    profile: str


@router.post("/purge")
async def purge(
    body: PurgeBody,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Destroy what an uninstalled app left behind: its files, its database,
    its object storage, its stored credentials and its access group. An
    action, not a commit, and not undone.

    One request, answered when the purge is over. The cluster refuses it,
    having destroyed nothing, while the tenant still has the app, while the
    app is still being taken down or while another purge of it runs (409). A
    purge that began and did not finish is a 500 that names the step that
    failed, what was already destroyed and what was not attempted; asking
    again is safe. Every answer arrives as it is.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{settings.tenant_id}/actions/purge-app",
        bearer_of(credentials),
        json_body={"profile": _name(body.profile)},
        timeout=_PURGE_TIMEOUT,
    )
