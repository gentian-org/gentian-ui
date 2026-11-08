"""A tenant's resources: read from the usher, changed at the director.

The Resources screen shows the ceiling the cluster enforces for a tenant, what
is committed under it, the cluster's plans, its history, and where to order
another plan. Every read here is live state and is relayed to the usher as the
caller, which has the operator's answers and decides from the authorization
graph whether this person may see them. Nothing is written here: a tenant is
moved by the cluster's administrators, and the notice the state carries
(``ordering``) says where to ask.

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
