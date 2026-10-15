"""The tenant's perimeter, for those who answer for it.

What asks to be on the internet, what is, and the history of who decided
each. Relays only: the director answers these reads under can_expose, the
relation that publishes, so an approver who is not otherwise a member of the
tenant sees what they approve. Approving and withdrawing go through the
Apps relays (apps.py), which are the same director routes.
"""

from fastapi import APIRouter, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin/perimeter", tags=["perimeter"])
_bearer = HTTPBearer(auto_error=False)


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
