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

# A purge waits for the app's teardown to finish before it deletes anything,
# which takes longer than the relay's ordinary patience.
_PURGE_TIMEOUT = httpx.Timeout(60.0)


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
    """Take one app out of this console's tenant. A commit; the app's data is
    kept, and a later install finds it again."""
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
    """Destroy what an uninstalled app left behind: its databases, its files,
    its secrets. An action, not a commit, and not undone.

    The cluster refuses it while the tenant still has the app (409), and
    answers 409 as well while the app is still being taken down -- the same
    request succeeds a little later. Both arrive as they are.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{settings.tenant_id}/actions/purge-app",
        bearer_of(credentials),
        json_body={"profile": _name(body.profile)},
        timeout=_PURGE_TIMEOUT,
    )
