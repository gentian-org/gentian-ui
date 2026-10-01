from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def _validate_client_id(claims: dict[str, Any], settings: Settings) -> None:
    """Accept tokens from the public portal client or the BFF ROPC client."""
    expected = [settings.oidc_expected_client_id, settings.portal_bff_client_id]
    expected = [client_id for client_id in expected if client_id]
    if not expected:
        return
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud] if aud else []
    azp = claims.get("azp")
    if any(client_id in audiences or azp == client_id for client_id in expected):
        return
    raise jwt.InvalidAudienceError("Token audience does not match portal client")


def _issuer_allowed(issuer: str, settings: Settings) -> bool:
    normalized = issuer.rstrip("/")
    kernel = (settings.oidc_issuer or "").rstrip("/")
    if kernel and normalized == kernel:
        return True
    external_prefix = f"https://id.{settings.kernel_domain}/auth/realms/"
    if normalized.startswith(external_prefix):
        return True
    if settings.keycloak_admin_url:
        internal_prefix = settings.keycloak_admin_url.rstrip("/") + "/realms/"
        if normalized.startswith(internal_prefix):
            return True
    return False


def _jwks_url_for_issuer(issuer: str, settings: Settings) -> str:
    issuer = issuer.rstrip("/")
    if settings.keycloak_admin_url and "/realms/" in issuer:
        realm_path = issuer[issuer.index("/realms/") :]
        return settings.keycloak_admin_url.rstrip("/") + realm_path + "/protocol/openid-connect/certs"
    return f"{issuer}/protocol/openid-connect/certs"


def _decode_token(token: str, settings: Settings) -> dict[str, Any]:
    unverified = jwt.decode(token, options={"verify_signature": False})
    issuer = (unverified.get("iss") or "").rstrip("/")
    if not _issuer_allowed(issuer, settings):
        raise jwt.InvalidIssuerError("Token issuer is not trusted")

    jwks_url = _jwks_url_for_issuer(issuer, settings)
    jwks = httpx.get(jwks_url, timeout=10.0).json()
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
    claims = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        issuer=issuer,
        options={"verify_aud": False},
    )
    _validate_client_id(claims, settings)
    return claims


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    settings = get_settings()
    if settings.auth_disabled or not settings.oidc_issuer:
        return {
            "sub": "dev-user",
            "preferred_username": "dev-user",
            "name": "Dev User",
            "email": "dev@gentian.local",
            "tenant": "demo",
            "groups": ["gentian:tenant:demo:admins", "gentian:tenant:demo:members"],
        }
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        claims = _decode_token(credentials.credentials, settings)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

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
