from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.tenant import resolve_user_context
from app.services.keycloak_user_groups import lookup_user_groups

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

    claims = _enrich_claims_from_userinfo(claims, credentials.credentials, settings)
    if not claims.get("groups"):
        groups = lookup_user_groups(claims, settings)
        if groups:
            claims["groups"] = groups
    claims["tenant"] = resolve_user_context(claims, settings)
    return claims


def _userinfo_url_for_issuer(issuer: str, settings: Settings) -> str | None:
    issuer = issuer.rstrip("/")
    if settings.keycloak_admin_url and "/realms/" in issuer:
        realm_path = issuer[issuer.index("/realms/") :]
        return settings.keycloak_admin_url.rstrip("/") + realm_path + "/protocol/openid-connect/userinfo"
    return f"{issuer}/protocol/openid-connect/userinfo"


def _enrich_claims_from_userinfo(
    claims: dict[str, Any], token: str, settings: Settings
) -> dict[str, Any]:
    """Fill missing profile/group claims from Keycloak userinfo."""
    needs_groups = not claims.get("groups")
    needs_username = not claims.get("preferred_username")
    if not needs_groups and not needs_username:
        return claims

    issuer = (claims.get("iss") or "").rstrip("/")
    userinfo_url = _userinfo_url_for_issuer(issuer, settings) if issuer else settings.oidc_userinfo_url
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
