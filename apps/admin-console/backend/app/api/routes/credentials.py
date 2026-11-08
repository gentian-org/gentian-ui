"""A person's own credentials, relayed to the custodian.

The custodian holds no authority of its own: every write takes the
caller's token and exchanges it for one OpenBao will accept, so what a person
may store is decided by their own identity rather than by a service acting for
them. This console holds neither its token nor OpenBao's — it passes the
person through, exactly as it does to the director.

Unset `CUSTODIAN_URL` answers 503 saying so, rather than guessing at
a host: a component that has not been told where something is has not been
told, and inventing an address would turn a configuration mistake into a
connection error somewhere else.

Repositories are on the same screen and are two services' business. Which
exist, and whether each has its credential, is the custodian's list. Where
one points is configuration, so declaring or removing one is a commit the
director makes; the custodian has no route for it. Its password is then a
credential like any other, `repository-<name>`, set through the custodian
once the declaration has reached the cluster.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/credentials", tags=["credentials"])
_bearer = HTTPBearer(auto_error=False)

# What the screen calls, and what the custodian calls it. The console
# keeps the paths its screen already uses; the service keeps its own. A map
# rather than a prefix rewrite, so a path this console does not serve is a 404
# here instead of an unexpected request there.
_PATHS: dict[tuple[str, str], str] = {
    ("GET", ""): "/v1/credentials",
    ("GET", "backup-identity"): "/v1/backup-identity",
    ("PUT", "backup-identity"): "/v1/backup-identity",
    ("GET", "repositories/list"): "/v1/repositories",
}


def _upstream(method: str, rest: str) -> str | None:
    """The custodian's path for one of the screen's."""
    if mapped := _PATHS.get((method, rest)):
        return mapped
    # The per-credential route is named by the thing it acts on, which the
    # screen already URL-encodes.
    if method == "PUT" and rest and "/" not in rest:
        return f"/v1/credentials/{rest}"
    return None


# A repository's name as the director accepts it. Checked here because it
# lands in a URL path: a name with a dot-dot in it would address a different
# route of the director than the one written below.
_NAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

# What a declaration may say. The director refuses a body with any other
# field, so only these travel: whose repository it is follows from the route,
# and its password is never part of a declaration.
_DECLARATION = ("role", "type", "url", "branch", "writable", "confirm")


def _repository_path(settings: Settings, name: str, scope: str, tenant: str | None) -> str:
    """The director's route for one repository: this console's tenant's
    unless the screen names another owner, the cluster's when it says so."""
    if not _NAME.match(name):
        raise HTTPException(
            status_code=400,
            detail="A repository's name is lower-case letters, digits and hyphens.",
        )
    if scope == "cluster":
        return f"/v1/clusters/{director.cluster(settings)}/repositories/{name}"
    return f"/v1/tenants/{tenant or settings.tenant_id}/repositories/{name}"


@router.put("/repositories/{name}")
async def declare_repository(
    name: str,
    body: dict,
    scope: str = Query(default="tenant"),
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A WRITE of declared state: 202 with a commit, which Argo CD applies on
    its next sync, or 200 when what was asked for already held. 428 means the
    change wants the name retyped, and says so in the fields the screen's
    danger zone reads."""
    declaration = {k: body[k] for k in _DECLARATION if body.get(k) not in (None, "")}
    return await director.forward(
        settings,
        "PUT",
        _repository_path(settings, name, scope, tenant),
        bearer_of(credentials),
        json_body=declaration,
    )


@router.delete("/repositories/{name}")
async def remove_repository(
    name: str,
    scope: str = Query(default="tenant"),
    tenant: str | None = Query(default=None),
    confirm: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Also a commit. Always wants the name repeated: without ?confirm= the
    director answers 428, which is how the screen learns what to ask for."""
    return await director.forward(
        settings,
        "DELETE",
        _repository_path(settings, name, scope, tenant),
        bearer_of(credentials),
        params={"confirm": confirm} if confirm else None,
    )


@router.api_route("", methods=["GET"])
@router.api_route("/{rest:path}", methods=["GET", "PUT"])
async def credentials(
    request: Request,
    rest: str = "",
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    path = _upstream(request.method, rest)
    if path is None:
        return Response(
            content='{"detail":"No such credentials route."}',
            status_code=404,
            media_type="application/json",
        )
    body = None
    if request.method in ("PUT", "POST"):
        raw = await request.body()
        if raw:
            import json

            body = json.loads(raw)
    return await director.forward_to(
        director.custodian_url(settings),
        request.method,
        path,
        bearer_of(credentials),
        json_body=body,
    )
