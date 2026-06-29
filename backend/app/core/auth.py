from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.tenant import resolve_user_context

_bearer = HTTPBearer(auto_error=False)


def _decode_token(token: str, issuer: str, audience: str | None) -> dict[str, Any]:
    jwks = httpx.get(issuer.rstrip("/") + "/protocol/openid-connect/certs", timeout=10.0).json()
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
    options = {"verify_aud": audience is not None}
    return jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options=options,
    )


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
            "tenant": settings.kernel_domain,
        }
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        claims = _decode_token(
            credentials.credentials,
            settings.oidc_issuer,
            settings.oidc_audience or settings.oidc_client_id,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    claims["tenant"] = resolve_user_context(claims, settings)
    if not claims.get("groups"):
        claims = _enrich_groups_from_userinfo(claims, credentials.credentials, settings)
    return claims


def _enrich_groups_from_userinfo(
    claims: dict[str, Any], token: str, settings: Any
) -> dict[str, Any]:
    """Keycloak emits group membership when the groups scope is authorized."""
    issuer = (settings.oidc_issuer or "").rstrip("/")
    if not issuer:
        return claims
    try:
        resp = httpx.get(
            f"{issuer}/protocol/openid-connect/userinfo",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        info = resp.json()
        if info.get("groups"):
            claims = {**claims, "groups": info["groups"]}
    except httpx.HTTPError:
        pass
    return claims
