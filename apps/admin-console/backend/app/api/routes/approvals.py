# SPDX-License-Identifier: Apache-2.0
"""The Approvals screen: what every tenant's apps ask of the node, and the
security officer's answer.

A podSecurity waiver or a cluster role weakens what protects the node and
every tenant on it, so it is approved at cluster scope (cluster#can_approve,
the security officer's) and never by the tenant that installed the app. The
tenant's administrator asks (the App Store's install step; the director
records the request on the app), and the list of what was asked is the
usher's, across every tenant. The approval itself is the director's existing
privilege route, for the request's tenant -- the one route that approves a
privilege, decided by the kind.

A decline is the officer's no: the director's action on the app, which it
authorises exactly as the approval of that kind, and which the operator
records on the app -- who, when, why -- without committing anything. The
privilege stays pending and the install keeps waiting; the tenant is told.

All three are relays and nothing more: the caller's own token, the
upstream's answer unchanged.
"""

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, StrictStr

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin/approvals", tags=["approvals"])
_bearer = HTTPBearer(auto_error=False)

_NAME = re.compile(r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")


def _name(value: str) -> str:
    if not _NAME.fullmatch(value):
        raise HTTPException(status_code=400, detail="That is not a valid name.")
    return value


@router.get("")
async def approvals(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Every tenant's requests of a privilege the security officer answers,
    with the profile's reason and who asked. The usher decides who reads it
    (can_approve or can_configure on the cluster)."""
    return await director.read(
        settings, f"/v1/clusters/{director.cluster(settings)}/approvals", bearer_of(credentials)
    )


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # In the approver's own words; the director wants at least ten characters.
    reason: StrictStr
    # RFC 3339. Absent: the approval stands until somebody withdraws it.
    expiresAt: StrictStr | None = None


@router.put("/{tenant}/{install}/{kind}/{name}")
async def approve(
    tenant: str,
    install: str,
    kind: Literal["podSecurity", "clusterRoles", "egress"],
    name: str,
    body: Approval,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Approve one request, for the tenant it was made in. The director's
    privilege route, which decides by the kind whether this person may and
    records them as the approver; its answer arrives as it is."""
    return await director.forward(
        settings,
        "PUT",
        f"/v1/tenants/{_name(tenant)}/privileges/{_name(install)}/{kind}/{_name(name)}",
        bearer_of(credentials),
        json_body=body.model_dump(exclude_none=True),
    )


class Decline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # In the approver's own words; the director wants at least ten characters.
    reason: StrictStr


@router.post("/{tenant}/{profile}/{kind}/{name}/decline")
async def decline(
    tenant: str,
    profile: str,
    kind: Literal["podSecurity", "clusterRoles", "egress"],
    name: str,
    body: Decline,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Decline one request, for the tenant it was made in. The director's
    action on the app, which decides by the kind whether this person may --
    the same right as the approval's -- and has the operator record them as
    the one who declined; its answer arrives as it is. Nothing is committed:
    the request stays pending, with the reason shown to whoever asked."""
    return await director.forward(
        settings,
        "POST",
        f"/v1/tenants/{_name(tenant)}/apps/{_name(profile)}/actions/decline-privilege",
        bearer_of(credentials),
        json_body={"privilege": f"{kind}/{_name(name)}", "reason": body.reason},
    )
