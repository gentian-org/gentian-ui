"""Who the caller is: the token is verified by gentian_app_runtime.auth, against
this desktop's one realm and the audience it was told to require.

What is added here is the desktop's own: the local-development user, and what
the caller holds on this desktop's tenant.
"""

from typing import Any

import httpx
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from gentian_app_runtime.auth import current_user

from app.core.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)
_verified = current_user(lambda: get_settings())


_DEV_USER = {
    "sub": "dev-user",
    "preferred_username": "dev-user",
    "name": "Dev User",
    "email": "dev@gentian.local",
    "tenant": "demo",
    "relations": {"can_administer": True, "can_enter": True},
    "positions": ["tenant-administrator", "user"],
}


async def get_signed_in_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    """Who the caller is, and nothing they hold: for a route that decides
    nothing on the caller's rights, such as a tile's picture, so that it
    costs no round trip to the usher.

    The relations are empty: a route that asks them all the same is refused.
    """
    settings = get_settings()
    if settings.auth_disabled:
        return dict(_DEV_USER)
    claims = await _verified(credentials)
    claims["tenant"] = settings.gentian_tenant or ""
    claims["relations"] = {}
    claims["positions"] = []
    return claims


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    settings = get_settings()
    if settings.auth_disabled:
        return dict(_DEV_USER)
    claims = await _verified(credentials)

    # Behind the edge, and only behind the edge.
    #
    # The token says nothing of what the caller holds and this process holds
    # no credential to look it up. The usher answers what the caller holds on
    # this desktop's tenant, with the caller's own token, and every decision
    # the shell makes reads that answer.
    claims["tenant"] = settings.gentian_tenant or ""
    held = await fetch_tenant_rights(credentials.credentials, settings)
    claims["relations"] = held["relations"]
    claims["positions"] = held["positions"]
    return claims


async def fetch_tenant_rights(token: str, settings: Settings) -> dict[str, Any]:
    """What the caller holds on this desktop's tenant, as the usher says: the
    relations, and the names of the tenant's positions.

    Forwarded with the caller's own token: OpenFGA decides, the usher asks
    it, this process relays. An usher that cannot be reached leaves the
    caller with nothing, which is the safe direction.
    """
    nothing: dict[str, Any] = {"relations": {}, "positions": []}
    if not settings.usher_url or not settings.gentian_tenant:
        return nothing
    url = f"{settings.usher_url.rstrip('/')}/v1/tenants/{settings.gentian_tenant}/me"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return nothing
    if resp.status_code != 200:
        return nothing
    body = resp.json()
    relations = body.get("relations") if isinstance(body, dict) else None
    positions = body.get("positions") if isinstance(body, dict) else None
    return {
        "relations": {k: bool(v) for k, v in relations.items()} if isinstance(relations, dict) else {},
        "positions": [p for p in positions if isinstance(p, str)] if isinstance(positions, list) else [],
    }
