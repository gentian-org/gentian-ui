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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    settings = get_settings()
    if settings.auth_disabled:
        return {
            "sub": "dev-user",
            "preferred_username": "dev-user",
            "name": "Dev User",
            "email": "dev@gentian.local",
            "tenant": "demo",
            "groups": ["gentian:tenant:demo:admins", "gentian:tenant:demo:members"],
        }
    claims = await _verified(credentials)

    # Behind the edge, and only behind the edge.
    #
    # The token names no groups and this process holds no credential to look
    # any up. The director answers what the caller holds on this desktop's
    # tenant, with the caller's own token, and every decision the shell makes
    # reads that answer.
    #
    # There used to be a second path for a browser-OIDC session, which enriched
    # the claims from userinfo and then, if that still named no groups, asked
    # Keycloak's ADMIN API what groups the person was in. That last step is a
    # credential this service should not hold, and the path it served -- the
    # desktop's own login page -- is gone with it.
    claims["tenant"] = settings.gentian_tenant or ""
    claims["relations"] = await fetch_tenant_relations(credentials.credentials, settings)
    return claims


async def fetch_tenant_relations(token: str, settings: Settings) -> dict[str, bool]:
    """What the caller holds on this desktop's tenant, as the director says.

    Forwarded with the caller's own token: the director decides, this
    process relays. A director that cannot be reached leaves the caller with
    nothing, which is the safe direction.
    """
    if not settings.director_url or not settings.gentian_tenant:
        return {}
    url = f"{settings.director_url.rstrip('/')}/v1/tenants/{settings.gentian_tenant}/me"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return {}
    if resp.status_code != 200:
        return {}
    body = resp.json()
    relations = body.get("relations") if isinstance(body, dict) else None
    return {k: bool(v) for k, v in relations.items()} if isinstance(relations, dict) else {}
