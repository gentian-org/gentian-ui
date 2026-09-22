"""Client for the gentian-os director.

The director is the only writer to the deployments repository and the only
reader of what it holds. It authenticates every request against Keycloak and
asks OpenFGA whether the caller may make it.

So this module decides nothing. It forwards the signed-in person's own access
token and hands back the director's answer, status included: there is no service
credential here, no actor header, and no check of groups or roles — a desktop
that re-implemented the director's decision would be a second place for it to
be wrong. What a person sees and may change is whatever the director says they
may.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings


class DirectorUnavailable(Exception):
    """The director could not be reached, or is not configured."""


class DirectorRefused(Exception):
    """The director answered, and the answer was no.

    The status is carried through, because the director distinguishes cases the
    desktop presents differently: 401 (sign in again), 403 (not yours to do),
    404 (no such tenant or app), 409 (someone else got there first — retry, or a
    newer statement is recorded). ``request_id`` is what joins this refusal to
    the director's decision log.
    """

    def __init__(self, status_code: int, detail: str, request_id: str | None = None) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.request_id = request_id


def _base_url(settings: Settings) -> str:
    if not settings.director_url:
        raise DirectorUnavailable(
            "The director is not configured for this desktop (set DIRECTOR_URL)."
        )
    return settings.director_url.rstrip("/")


async def _call(
    settings: Settings,
    method: str,
    path: str,
    *,
    token: str,
    json_body: dict[str, Any] | None = None,
    request_id: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    if not token:
        # Never fall back to anything else: no token means no identity.
        raise DirectorRefused(401, "Not authenticated")
    headers = {"Authorization": f"Bearer {token}"}
    if request_id:
        headers["X-Request-Id"] = request_id
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            response = await client.request(
                method, f"{_base_url(settings)}{path}", headers=headers, json=json_body
            )
    except httpx.TimeoutException as exc:
        raise DirectorUnavailable("The director timed out.") from exc
    except httpx.HTTPError as exc:
        raise DirectorUnavailable(f"The director could not be reached: {exc}") from exc

    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if response.status_code >= 500:
        raise DirectorUnavailable(str(body.get("error") or "The director failed."))
    if response.status_code >= 400:
        raise DirectorRefused(
            response.status_code,
            str(body.get("error") or response.reason_phrase),
            body.get("request_id") or response.headers.get("X-Request-Id"),
        )
    return body


async def list_apps(settings: Settings, tenant: str, *, token: str, **kw: Any) -> list[dict[str, Any]]:
    body = await _call(settings, "GET", f"/v1/tenants/{tenant}/apps", token=token, **kw)
    return list(body.get("apps") or [])


async def install_app(
    settings: Settings, tenant: str, profile: str, *, token: str, coordinate: str | None = None, **kw: Any
) -> dict[str, Any]:
    payload = {"coordinate": coordinate} if coordinate else None
    return await _call(
        settings, "POST", f"/v1/tenants/{tenant}/apps/{profile}", token=token, json_body=payload, **kw
    )


async def uninstall_app(settings: Settings, tenant: str, profile: str, *, token: str, **kw: Any) -> dict[str, Any]:
    return await _call(settings, "DELETE", f"/v1/tenants/{tenant}/apps/{profile}", token=token, **kw)


async def get_addons(settings: Settings, tenant: str, profile: str, *, token: str, **kw: Any) -> list[str]:
    body = await _call(settings, "GET", f"/v1/tenants/{tenant}/apps/{profile}/addons", token=token, **kw)
    return list(body.get("addons") or [])


async def set_addons(
    settings: Settings, tenant: str, profile: str, addons: list[str], *, token: str, **kw: Any
) -> dict[str, Any]:
    return await _call(
        settings,
        "PUT",
        f"/v1/tenants/{tenant}/apps/{profile}/addons",
        token=token,
        json_body={"addons": addons},
        **kw,
    )


async def list_entitlements(settings: Settings, tenant: str, *, token: str, **kw: Any) -> list[dict[str, Any]]:
    body = await _call(settings, "GET", f"/v1/tenants/{tenant}/entitlements", token=token, **kw)
    return list(body.get("entitlements") or [])


async def deliver_entitlement(settings: Settings, tenant: str, grant: str, *, token: str, **kw: Any) -> dict[str, Any]:
    """Hand the director a statement the store signed. The desktop carries it; it
    cannot make one."""
    return await _call(
        settings, "POST", f"/v1/tenants/{tenant}/entitlements", token=token, json_body={"grant": grant}, **kw
    )


async def kernel_tiles(settings: Settings, cluster: str, *, token: str, **kw: Any) -> dict[str, Any]:
    """The kernel's own UIs, as the director filters them for this person."""
    return await _call(settings, "GET", f"/v1/clusters/{cluster}/tiles", token=token, **kw)
