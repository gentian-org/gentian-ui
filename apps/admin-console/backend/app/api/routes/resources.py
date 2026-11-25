"""A tenant's resources: read from the usher, changed at the director.

The Resources screen shows the ceiling the cluster enforces for a tenant, what
is committed under it, the cluster's plans, its history, and where to order
another plan. Every read here is live state and is relayed to the usher as the
caller, which has the operator's answers and decides from the authorization
graph whether this person may see them. The one write, moving a tenant to a
plan, is the cluster's administrators': a commit the director makes as the
person, after asking the graph whether they may configure the cluster. A
tenant administrator orders another plan where the notice the state carries
(``ordering``) says.

Which tenant is asked is the screen's choice: a tenant administrator's own,
or, for a platform operator managing from the cluster's view, any tenant of
the cluster. The console does not check that choice; the service asked does,
and its refusal comes back as the refusal it is.
"""

from fastapi import APIRouter, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin/resources", tags=["resources"])
_bearer = HTTPBearer(auto_error=False)


def _tenant_path(settings: Settings, tenant: str | None, suffix: str = "") -> str:
    return f"/v1/tenants/{tenant or settings.tenant_id}/resources{suffix}"


@router.get("")
async def resource_state(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The tenant's ceiling, what is under it, and the plan it is on."""
    return await director.read(settings, _tenant_path(settings, tenant), bearer_of(credentials))


@router.get("/plans")
async def resource_plans(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The cluster's plans as they apply to this tenant, for reading."""
    answer = await director.read(
        settings, _tenant_path(settings, tenant, "/plans"), bearer_of(credentials)
    )
    return director.unwrapped(answer, "plans")


@router.put("")
async def change_resource_plan(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Move a tenant to a plan: ``{"plan": "<name>", "force": false}``.

    202 with a commit means git has it and the cluster does not yet; 200 means
    the tenant is on that plan already. A plan the tenant does not fit under
    is 409 unless forced, and anyone who may not configure the cluster is
    refused 403 by the director; both come back unchanged."""
    path = f"/v1/clusters/{director.cluster(settings)}/tenants/{tenant or settings.tenant_id}/resources"
    return await director.forward(settings, "PUT", path, bearer_of(credentials), json_body=body)


def _request_path(settings: Settings, tenant: str | None) -> str:
    return (
        f"/v1/clusters/{director.cluster(settings)}/tenants/"
        f"{tenant or settings.tenant_id}/resources/request"
    )


@router.put("/request")
async def request_resource_plan(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A tenant administrator asks for a plan: ``{"plan": "<name>", "reason": "..."}``.
    The director commits the request as the person; the cluster's
    administrators answer it by moving the tenant or declining."""
    return await director.forward(
        settings, "PUT", _request_path(settings, tenant), bearer_of(credentials), json_body=body
    )


@router.delete("/request")
async def clear_resource_plan_request(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Withdraw the tenant's request (its administrator) or decline it (the
    cluster's); the director decides which from the caller's relations."""
    return await director.forward(
        settings, "DELETE", _request_path(settings, tenant), bearer_of(credentials)
    )


@router.get("/usage")
async def resource_usage(
    tenant: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    stepSeconds: int | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    params = {
        k: str(v)
        for k, v in {"from": from_, "to": to, "stepSeconds": stepSeconds}.items()
        if v is not None
    }
    return await director.read(
        settings,
        _tenant_path(settings, tenant, "/usage"),
        bearer_of(credentials),
        params=params,
    )


@router.get("/report")
async def resource_report(
    tenant: str | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    params = {k: v for k, v in {"from": from_, "to": to}.items() if v is not None}
    return await director.read(
        settings,
        _tenant_path(settings, tenant, "/report"),
        bearer_of(credentials),
        params=params,
    )


@router.get("/tenants")
async def tenant_resource_states(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Every tenant's ceiling side by side, for the cluster's view: the
    tenants the cluster holds, as the operator answers for them."""
    answer = await director.read(
        settings,
        f"/v1/clusters/{director.cluster(settings)}/resources",
        bearer_of(credentials),
    )
    return director.unwrapped(answer, "tenants")
