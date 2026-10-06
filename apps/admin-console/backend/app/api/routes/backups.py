# SPDX-License-Identifier: Apache-2.0
"""Exports, as the director answers for them.

What bundles exist and what each run did is cluster state the export
reconciler holds, relayed by the director to whoever may view the tenant.

Two kinds of call, and the routes say which:

    GET  ...                a READ of state -- what is.
    POST .../actions/x      an ACTION -- something that happens once, now.
                            Answers what was started. There is no commit,
                            because nothing was declared.

Scheduled backups, the backup policy and its destinations are declared state
and not this console's: they are the Operations Console's screens, which
relay to the same director. This console takes one export, now, to the
cluster's own storage, and lists what is there.
"""

from fastapi import APIRouter, Depends, Query, Response
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
    answer = await director.forward(
        settings, "GET", f"/v1/tenants/{_tenant(settings, tenant)}/backups", bearer_of(credentials)
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
    return await director.forward(
        settings,
        "GET",
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
