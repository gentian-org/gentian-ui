"""Who the tenant is: Tenant Settings.

The display name, legal name, country, languages, currency, time zone,
address and the rest an app sets itself up from. All of it is declared in
the tenant's manifest; the director commits it under can_set_policy and
answers which of the required facts are still missing.

The director keeps the country and the languages behind their own calls,
because each has its own consumer (the App Store, the realm). The screen
saves them as one form, so a save is up to three commits: country first,
because a currency left empty is filled in from it.
"""

from fastapi import APIRouter, Depends, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["tenant-settings"])
_bearer = HTTPBearer(auto_error=False)


def _tenant(settings: Settings, tenant: str | None) -> str:
    return tenant or settings.tenant_id


@router.get("/tenant-settings")
async def tenant_settings(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Who the tenant is, and what is still missing."""
    return await director.forward(
        settings,
        "GET",
        f"/v1/tenants/{_tenant(settings, tenant)}/organization",
        bearer_of(credentials),
    )


@router.put("/tenant-settings")
async def set_tenant_settings(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Commits the form: country, languages, then the organisation. The first
    refusal is the answer; a part that did not change commits nothing."""
    base = f"/v1/tenants/{_tenant(settings, tenant)}"
    token = bearer_of(credentials)
    writes = []
    if "country" in body:
        writes.append(("/country", {"country": body.get("country") or ""}))
    if "locales" in body:
        writes.append(("/locales", {"locales": body.get("locales") or []}))
    writes.append(
        (
            "/organization",
            {
                "displayName": body.get("displayName") or "",
                "organization": body.get("organization") or {},
            },
        )
    )
    answer = None
    for path, payload in writes:
        answer = await director.forward(settings, "PUT", base + path, token, json_body=payload)
        if answer.status_code >= 300:
            return answer
    return answer
