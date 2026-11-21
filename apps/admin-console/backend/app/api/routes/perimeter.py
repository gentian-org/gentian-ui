"""The tenant's perimeter, for those who answer for it.

What asks to be on the internet, what is, and the history of who decided
each. Relays only: the director answers these reads under can_expose, the
relation that publishes, so an approver who is not otherwise a member of the
tenant sees what they approve. Approving and withdrawing go through the
Apps relays (apps.py), which are the same director routes.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin/perimeter", tags=["perimeter"])
_bearer = HTTPBearer(auto_error=False)

# A domain as the director takes one: lower-case labels, at least two.
_DOMAIN = re.compile(r"^([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)+[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")


def _domain(value: str) -> str:
    if len(value) > 253 or not _DOMAIN.match(value):
        raise HTTPException(status_code=400, detail="That is not a domain.")
    return value


@router.get("/exposures")
async def exposures(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Every entry the tenant's apps declare for the internet, and its state."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{settings.tenant_id}/perimeter/exposures",
        bearer_of(credentials),
    )


@router.get("/history")
async def history(
    limit: int | None = Query(default=None, ge=1, le=500),
    since: str | None = Query(default=None, max_length=64),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who published, reviewed or withdrew which entry, from the commits."""
    params = {k: str(v) for k, v in (("limit", limit), ("since", since)) if v is not None}
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{settings.tenant_id}/perimeter/history",
        bearer_of(credentials),
        params=params or None,
    )


@router.get("/traffic")
async def traffic(
    from_: str | None = Query(default=None, alias="from", max_length=40),
    to: str | None = Query(default=None, max_length=40),
    stepSeconds: int | None = Query(default=None, ge=60),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What the tenant's public paths carried, read from the usher, which
    answers it under can_expose: live state, not git."""
    params = {
        k: str(v)
        for k, v in (("from", from_), ("to", to), ("stepSeconds", stepSeconds))
        if v is not None
    }
    return await director.read(
        settings,
        f"/v1/tenants/{settings.tenant_id}/perimeter/traffic",
        bearer_of(credentials),
        params=params or None,
    )


@router.get("/trusted-domains")
async def trusted_domains(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The domains trusted for this tenant alone, and whether the cluster's
    administrator delegated keeping them to the tenant. A read, of git."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{settings.tenant_id}/trusted-domains",
        bearer_of(credentials),
    )


@router.put("/trusted-domains/{domain}")
async def trust_domain(
    domain: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Trust one more domain for this tenant. A commit: an egress request
    whose hosts are all in trusted domains then needs no further answer.
    Whether the person may is the director's, and its answer arrives as it
    is."""
    return await director.forward(
        settings,
        "PUT",
        f"/v1/tenants/{settings.tenant_id}/trusted-domains/{_domain(domain)}",
        bearer_of(credentials),
    )


@router.delete("/trusted-domains/{domain}")
async def stop_trusting_domain(
    domain: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Stop trusting one domain for this tenant. A commit: a request it
    answered waits for an answer again."""
    return await director.forward(
        settings,
        "DELETE",
        f"/v1/tenants/{settings.tenant_id}/trusted-domains/{_domain(domain)}",
        bearer_of(credentials),
    )
