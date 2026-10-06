"""What the App Store asks of this cluster, relayed to the director.

The store runs outside the cluster and holds no credential for it (AD-3). It
is shown in a window on this desktop, and everything it needs from the cluster
-- what is installed, how it is doing, install this, remove that -- it asks of
the desktop, which asks the director with the token of the person sitting at
it (AD-13: the desktop is the only thing that token is forwarded to).

So this module is the cluster's half of the store, and it is deliberately
thin. It adds no authority: every request carries the CALLER's bearer token
and the director decides, per relation, what that person may read or write.
It names no app and knows no catalogue. What it does add is a closed list --
the store can reach exactly the routes below and nothing else of the director,
however it phrases the request.

Two of them are reads of live state -- how the installed apps are doing, and
what the tenant has used of its plan -- and those are the usher's to answer,
with the same token, on the same paths. The director answers 404 on them and
is not asked instead.
"""

import re
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from urllib.parse import urlsplit

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/store", tags=["store"])

_bearer = HTTPBearer(auto_error=False)
_TIMEOUT = httpx.Timeout(30.0)

# A profile or a catalogue source, as the director names them. Checked here
# because these land in a URL path: a name with a slash or a dot-dot in it
# would address a different route of the director than the one written below.
_NAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def _base_url(settings: Settings) -> str:
    url = getattr(settings, "director_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The director is not configured for this cluster.",
        )
    return url.rstrip("/")


def _usher_url(settings: Settings) -> str:
    url = getattr(settings, "usher_url", None)
    if not url:
        raise HTTPException(
            status_code=503,
            detail="The usher is not configured for this cluster: USHER_URL "
            "(the chart value usher.url) is not set.",
        )
    return url.rstrip("/")


def _tenant(settings: Settings) -> str:
    name = getattr(settings, "gentian_tenant", None)
    if not name:
        raise HTTPException(
            status_code=503,
            detail="This desktop does not know which tenant it belongs to.",
        )
    return name


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="A bearer token is required.")
    return credentials.credentials


def _name(value: str, what: str) -> str:
    if not _NAME.match(value):
        raise HTTPException(status_code=400, detail=f"That is not a valid {what} name.")
    return value


async def _ask(
    settings: Settings,
    credentials: HTTPAuthorizationCredentials | None,
    method: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    body: Any = None,
    live: bool = False,
) -> httpx.Response:
    """One request to the director, as the caller -- or, for a read of live
    state, to the usher."""
    base = _usher_url(settings) if live else _base_url(settings)
    service = "usher" if live else "director"
    url = f"{base}/v1/tenants/{_tenant(settings)}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            return await client.request(
                method,
                url,
                params=params,
                json=body,
                headers={"Authorization": f"Bearer {_token(credentials)}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"The {service} is unreachable: {exc}",
        ) from exc


def _relay(upstream: httpx.Response) -> Response:
    """The answer, unchanged: its status is the answer too."""
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


def _origin(url: str | None) -> str | None:
    """scheme://host[:port] of an https URL, or nothing.

    The desktop accepts messages from exactly this origin. Anything that is
    not https is refused rather than normalised: a store reached in the clear
    is not one to take instructions from.
    """
    if not url:
        return None
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.netloc:
        return None
    return f"https://{parts.netloc}"


@router.get("/context")
async def context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Who is asking, of which tenant, and which store this cluster listens to.

    The store's address comes from the Cluster claim, through the director. It
    is what pins the bridge: the desktop takes store requests from that origin
    and no other, so which store may ask anything of this cluster is a
    decision recorded in git, not one made by whatever page is in the frame.
    """
    tenant = _tenant(settings)
    me = await _ask(settings, credentials, "GET", "/me")
    if me.status_code != 200:
        # Not a member of this tenant, or no session: there is no context to
        # give, and the director's own answer says which.
        raise HTTPException(status_code=me.status_code, detail="You may not enter this tenant.")
    relations = me.json().get("relations") or {}

    store_url = None
    catalogues = await _ask(settings, credentials, "GET", "/catalogues")
    if catalogues.status_code == 200:
        store_url = catalogues.json().get("storeUrl") or None

    return {
        "cluster": getattr(settings, "cluster_id", None),
        "tenant": tenant,
        "relations": relations,
        "storeUrl": store_url,
        "storeOrigin": _origin(store_url),
    }


@router.get("/apps")
async def apps(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What git says this tenant has installed."""
    return _relay(await _ask(settings, credentials, "GET", "/apps"))


@router.get("/apps/status")
async def apps_status(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What the cluster has made of it: installing, ready or failing."""
    return _relay(await _ask(settings, credentials, "GET", "/apps/status", live=True))


@router.post("/apps/{profile}")
async def install(
    profile: str,
    body: dict[str, Any] = Body(default_factory=dict),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    # The coordinate, the digest and defaultGrant go on, and nothing else. The
    # coordinate is which catalogue entry is meant; the digest is which bytes
    # the entry IS, as the store stated it over its own TLS, and the director
    # admits the bundle it fetches only because it hashes to that (AD-3).
    # defaultGrant is whether the app is installed for everyone: true gives
    # every member of the tenant access once the app is ready, and the
    # director asks can_grant for it beside can_install_app. Whether this
    # person may is the director's question. A body passed through whole would
    # be a way to reach a field the director grows later without anybody
    # deciding the store may set it.
    payload: dict[str, Any] = {"coordinate": str(body.get("coordinate") or "")}
    digest = str(body.get("digest") or "")
    if digest:
        if not _DIGEST.match(digest):
            raise HTTPException(status_code=400, detail="digest is sha256:<64 hex>.")
        payload["digest"] = digest
    if "defaultGrant" in body:
        # A boolean and nothing shaped like one: "true" or 1 would be read by
        # somebody as a yes that the person confirming was never shown.
        if not isinstance(body["defaultGrant"], bool):
            raise HTTPException(status_code=400, detail="defaultGrant is true or false.")
        payload["defaultGrant"] = body["defaultGrant"]
    return _relay(
        await _ask(
            settings, credentials, "POST", f"/apps/{_name(profile, 'profile')}", body=payload
        )
    )


@router.delete("/apps/{profile}")
async def uninstall(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return _relay(await _ask(settings, credentials, "DELETE", f"/apps/{_name(profile, 'profile')}"))


async def _action(
    action: str,
    profile: str,
    settings: Settings,
    credentials: HTTPAuthorizationCredentials | None,
) -> Response:
    """Something done once to one app. The profile is all that travels."""
    return _relay(
        await _ask(
            settings,
            credentials,
            "POST",
            f"/actions/{action}",
            body={"profile": _name(profile, "profile")},
        )
    )


@router.post("/apps/{profile}/purge")
async def purge(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Delete what an uninstalled app left behind. Refused while it is installed."""
    return await _action("purge-app", profile, settings, credentials)


@router.post("/apps/{profile}/provision")
async def provision(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Grant an installed app to everybody who is a member now."""
    return await _action("provision-app", profile, settings, credentials)


@router.get("/apps/{profile}/addons")
async def addons(
    profile: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return _relay(
        await _ask(settings, credentials, "GET", f"/apps/{_name(profile, 'profile')}/addons")
    )


@router.put("/apps/{profile}/addons")
async def set_addons(
    profile: str,
    body: dict[str, Any] = Body(default_factory=dict),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    wanted = body.get("addons")
    if not isinstance(wanted, list) or not all(isinstance(a, str) for a in wanted):
        raise HTTPException(status_code=400, detail="addons is a list of profile names.")
    payload = {"addons": [_name(a, "add-on") for a in wanted]}
    return _relay(
        await _ask(
            settings,
            credentials,
            "PUT",
            f"/apps/{_name(profile, 'profile')}/addons",
            body=payload,
        )
    )


@router.get("/resources")
async def resources(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tenant's plan and what it has used of it."""
    return _relay(await _ask(settings, credentials, "GET", "/resources", live=True))


@router.get("/catalogues")
async def catalogues(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return _relay(await _ask(settings, credentials, "GET", "/catalogues"))


@router.get("/catalogues/{source}/entries")
async def catalogue_entries(
    source: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return _relay(
        await _ask(
            settings,
            credentials,
            "GET",
            f"/catalogues/{_name(source, 'catalogue')}/entries",
            params=dict(request.query_params),
        )
    )
