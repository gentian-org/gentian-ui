"""The cluster's own catalogues — the plain fallback, not a shop.

The App Store is where somebody should be looking. It knows what an app is
for, what it costs, who maintains it, and it is kept current by people whose
job that is. This screen is what remains when the store is not the answer:
it is unreachable, or the cluster is air-gapped, or — the case with no store
answer at all — the entry is this operator's own profile in their own
repository, which nobody sells and nobody else lists.

So it shows coordinates, versions and editions, and nothing else. Everything
here is relayed from the director, which lists only the community (ce) and
private (pe) editions of the sources named on the Cluster claim and counts
the rest as the store's (AD-14). None of that is decided here.

An entry the listing calls installable can be installed from here -- for
everyone, if the person says so -- and an installed app uninstalled. Those
are relays too, for the tenant this console runs in: the person's own token
goes to the director, which asks whether they may (can_install_app, and
can_grant for an install for everyone), and its status and body come back as
they are.
"""

from fastapi import APIRouter, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/catalogue", tags=["catalogue"])
_bearer = HTTPBearer(auto_error=False)


@router.get("/sources")
async def sources(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Which catalogues this cluster may fetch from.

    `storeUrl` comes back with them, because the honest answer to most of this
    screen is "go to the App Store" and the screen needs somewhere to point.
    """
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{tenant or settings.tenant_id}/catalogues",
        bearer_of(credentials),
    )


@router.get("/sources/{source}/entries")
async def entries(
    source: str,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What is in one catalogue.

    An entry is `installable` when its source states a digest for it.
    `storeOnly` says how many further entries are the App Store's and not
    listed here at all.
    """
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{tenant or settings.tenant_id}/catalogues/{source}/entries",
        bearer_of(credentials),
    )


class InstallBody(BaseModel):
    """What an install of a listed entry states: where the profile comes
    from, and which build. Both are the entry listing's own words, handed
    back; a missing one is the director's to refuse, not this component's.

    `defaultGrant` is who gets the app: true installs it for everyone, false
    says access is given per person, and unstated leaves an installed app's
    entry as it is -- so it is sent on only when it was stated."""

    coordinate: str | None = None
    digest: str | None = None
    defaultGrant: bool | None = None


@router.post("/apps/{profile}")
async def install(
    profile: str,
    body: InstallBody,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Install one catalogue entry into this console's tenant.

    A commit, not a rollout: 202 with a commit means git has it and the
    cluster does not yet, 200 means the tenant already had that build. The
    digest pins the bytes, and the director refuses a source that serves
    anything else. With `defaultGrant` true the cluster gives every member
    access once the app is ready, by itself; the director asks can_grant for
    that as well. All of that is its answer and arrives unchanged.
    """
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{settings.tenant_id}/apps/{profile}",
        bearer_of(credentials),
        json_body=body.model_dump(exclude_none=True),
    )


@router.delete("/apps/{profile}")
async def uninstall(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Take one app out of this console's tenant. A commit, like the install."""
    return await director.forward(
        settings,
        "DELETE",
        f"/v1/tenants/{settings.tenant_id}/apps/{profile}",
        bearer_of(credentials),
    )
