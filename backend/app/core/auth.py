from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.tenant import resolve_user_context

_bearer = HTTPBearer(auto_error=False)


def _validate_client_id(claims: dict[str, Any], expected: str | None) -> None:
    """Keycloak public clients often emit azp instead of aud."""
    if not expected:
        return
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud] if aud else []
    if expected in audiences or claims.get("azp") == expected:
        return
    raise jwt.InvalidAudienceError("Token audience does not match portal client")


def _decode_token(token: str, settings: Settings) -> dict[str, Any]:
    issuer = (settings.oidc_issuer or "").rstrip("/")
    jwks_url = settings.oidc_jwks_url or f"{issuer}/protocol/openid-connect/certs"
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
    _validate_client_id(claims, settings.oidc_expected_client_id)
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

    claims["tenant"] = resolve_user_context(claims, settings)
    claims = _enrich_claims_from_userinfo(claims, credentials.credentials, settings)
    return claims


def _enrich_claims_from_userinfo(
    claims: dict[str, Any], token: str, settings: Settings
) -> dict[str, Any]:
    """Fill missing profile/group claims from Keycloak userinfo."""
    needs_groups = not claims.get("groups")
    needs_username = not claims.get("preferred_username")
    if not needs_groups and not needs_username:
        return claims

    userinfo_url = settings.oidc_userinfo_url
    if not userinfo_url:
        return claims
    try:
        resp = httpx.get(
            userinfo_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        info = resp.json()
        merged = {**claims}
        if needs_groups and info.get("groups"):
            merged["groups"] = info["groups"]
        if needs_username and info.get("preferred_username"):
            merged["preferred_username"] = info["preferred_username"]
        if not merged.get("email") and info.get("email"):
            merged["email"] = info["email"]
        return merged
    except httpx.HTTPError:
        return claims
