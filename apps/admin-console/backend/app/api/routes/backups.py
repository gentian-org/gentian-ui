# SPDX-License-Identifier: Apache-2.0
"""Exports: read from the usher, taken and downloaded at the director.

What bundles exist and what each run did is cluster state the export
reconciler holds, answered by the usher to whoever may view the tenant.

Two kinds of call, and the routes say which:

    GET  ...                a READ of state -- what is. Asked of the usher,
                            except the bundle itself, which the usher's
                            token does not fetch and the director streams.
    POST .../actions/x      an ACTION -- something that happens once, now.
                            Asked of the director. Answers what was started.
                            There is no commit, because nothing was declared.

Scheduled backups and the backup policy's destinations and keys are declared
state and not this console's: they are the Operations Console's screens,
which relay to the same director. This console takes one export, now, to the
cluster's own storage, and lists what is there. Of the backup policy it sets
one thing: what is exported before an app update (beforeMove).
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["backups"])
_bearer = HTTPBearer(auto_error=False)


def _tenant(settings: Settings, tenant: str | None) -> str:
    return tenant or settings.tenant_id


@router.get("/backups")
async def backups(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    answer = await director.read(
        settings, f"/v1/tenants/{_tenant(settings, tenant)}/backups", bearer_of(credentials)
    )
    return director.unwrapped(answer, "backups")


@router.get("/backups/{name}")
async def backup(
    name: str,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.read(
        settings,
        f"/v1/tenants/{_tenant(settings, tenant)}/backups/{name}",
        bearer_of(credentials),
    )


@router.get("/backups/{name}/download")
async def download_backup(
    name: str,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """The bundle as one file, streamed through from the director. Not a
    signed URL: the person's own session is what opens it, so it can be
    revoked like anything else they may do here."""
    return await director.stream(
        settings,
        f"/v1/tenants/{_tenant(settings, tenant)}/backups/{name}/download",
        bearer_of(credentials),
    )


@router.post("/backups")
async def take_backup(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Take one now. The answer says what was started, not what was saved."""
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/backup",
        bearer_of(credentials),
        json_body=body,
    )


@router.delete("/backups/{name}")
async def delete_backup(
    name: str,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Remove one run's record. Also an action: what happens to the bundle in
    storage is the retention policy's answer, and nothing the tenant declares
    changes."""
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_tenant(settings, tenant)}/actions/delete-backup",
        bearer_of(credentials),
        json_body={"name": name},
    )


# What is exported before an app update (gentian-os docs/concepts/versioning.md
# §5); "" inherits the cluster's.
_BEFORE_MOVE = ("", "tenant", "app", "none")


@router.get("/backup-policy")
async def backup_policy(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tenant's backup policy: what it states and what applies."""
    return await director.read(
        settings, f"/v1/tenants/{_tenant(settings, tenant)}/backup-policy", bearer_of(credentials)
    )


def _stated(policy: dict) -> dict:
    """What a tenant's policy states besides beforeMove, in the shape the
    director commits: the director writes the policy whole, so a write of
    beforeMove alone carries the rest along unchanged."""
    if not policy.get("configured"):
        return {}
    stated: dict = {}
    destination = {
        key: value
        for key, value in (policy.get("destination") or {}).items()
        if key in ("endpoint", "bucket", "region", "addressingStyle") and value
    }
    if destination:
        stated["destination"] = destination
    recipients = (policy.get("encryption") or {}).get("recipients") or []
    if recipients:
        stated["encryption"] = {"recipients": recipients}
    return stated


@router.put("/backup-policy/before-move")
async def set_before_move(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Set what is exported before an app update, and nothing else of the
    policy. "" goes back to the cluster's; a tenant that then states nothing
    has its policy removed, which is how it inherits."""
    mode = body.get("beforeMove", "")
    if mode not in _BEFORE_MOVE:
        raise HTTPException(status_code=422, detail="beforeMove is tenant, app, none or empty")
    path = f"/v1/tenants/{_tenant(settings, tenant)}/backup-policy"
    token = bearer_of(credentials)
    current = await director.read(settings, path, token)
    if current.status_code != 200:
        return current
    policy = json.loads(current.body)
    stated = _stated(policy)
    if mode:
        stated["beforeMove"] = mode
    if not stated:
        if not policy.get("configured"):
            # Inheriting already: nothing to write.
            return current
        return await director.forward(settings, "DELETE", path, token)
    return await director.forward(settings, "PUT", path, token, json_body=stated)
