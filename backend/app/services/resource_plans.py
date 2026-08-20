"""Client for the operator's resources API.

The console does not compute a tenant's ceiling, decide whether a downgrade is
safe, or write to the deployments repository. All three live in gentian-os
behind ``/v1/tenants/{tenant}/resources``, which is also what
``kubectl gentian resources`` calls — so the console and the CLI enforce one set
of rules rather than two that drift.

What this module adds on top is what only the BFF knows: which tenant the caller
may act on, and whether they are a tenant administrator (self-service) or a
platform operator. The entitlement ceiling is not sent from here — the operator
reads it from the Tenant, so no caller can raise it by omitting a field.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings


class ResourcesUnavailable(Exception):
    """The operator's resources API could not be reached."""


class ResourcesRefused(Exception):
    """The operator refused the request, with its own explanation.

    The status is carried through rather than flattened, because the operator
    distinguishes cases the console must present differently: a plan that does
    not fit today (409, retry after freeing something) is not a plan the tenant
    is not entitled to (402, buy it first).
    """

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _base_url(settings: Settings) -> str:
    if not settings.app_lifecycle_url:
        raise ResourcesUnavailable(
            "The resources API is not configured for this portal "
            "(set APP_LIFECYCLE_URL on the portal API)."
        )
    return settings.app_lifecycle_url.rstrip("/")


def _detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict) and body.get("detail"):
            return str(body["detail"])
    except ValueError:
        pass
    return response.text or response.reason_phrase


async def _call(
    settings: Settings,
    method: str,
    path: str,
    *,
    actor: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> Any:
    url = f"{_base_url(settings)}{path}"
    headers = {"X-Gentian-Actor": actor}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method, url, headers=headers, params=params, json=json_body
            )
    except httpx.TimeoutException as exc:
        raise ResourcesUnavailable("The resources API timed out.") from exc
    except httpx.TransportError as exc:
        raise ResourcesUnavailable("The resources API is unreachable.") from exc

    if not response.is_success:
        raise ResourcesRefused(response.status_code, _detail(response))
    return response.json()


async def fetch_state(settings: Settings, tenant: str, *, actor: str) -> dict[str, Any]:
    return await _call(settings, "GET", f"/v1/tenants/{tenant}/resources", actor=actor)


async def fetch_plans(
    settings: Settings,
    tenant: str,
    *,
    actor: str,
    self_service: bool,
) -> list[dict[str, Any]]:
    # No entitlement ceiling is sent: the operator reads it from the Tenant, so
    # it cannot be raised by a caller that omits it. self_service can only
    # withhold plans, so it is safe to assert from here.
    params: dict[str, Any] = {"selfService": "true" if self_service else "false"}
    payload = await _call(
        settings, "GET", f"/v1/tenants/{tenant}/resources/plans", actor=actor, params=params
    )
    return list(payload.get("plans") or [])


async def set_plan(
    settings: Settings,
    tenant: str,
    plan: str,
    *,
    actor: str,
    self_service: bool,
    force: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {"plan": plan, "selfService": self_service, "force": force}
    # Longer than a read: the operator pulls, rewrites, commits and pushes to
    # the deployments repository before answering, and a slow remote should not
    # look to the console like a plan change that failed.
    return await _call(
        settings,
        "PUT",
        f"/v1/tenants/{tenant}/resources",
        actor=actor,
        json_body=body,
        timeout=120.0,
    )


async def fetch_usage(
    settings: Settings,
    tenant: str,
    *,
    actor: str,
    frm: str | None = None,
    to: str | None = None,
    step_seconds: int | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if frm:
        params["from"] = frm
    if to:
        params["to"] = to
    if step_seconds:
        params["stepSeconds"] = step_seconds
    return await _call(
        settings, "GET", f"/v1/tenants/{tenant}/resources/usage", actor=actor, params=params
    )


async def fetch_report(
    settings: Settings,
    tenant: str,
    *,
    actor: str,
    frm: str | None = None,
    to: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if frm:
        params["from"] = frm
    if to:
        params["to"] = to
    return await _call(
        settings, "GET", f"/v1/tenants/{tenant}/resources/report", actor=actor, params=params
    )
