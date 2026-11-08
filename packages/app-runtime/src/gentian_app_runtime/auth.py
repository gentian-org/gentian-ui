# SPDX-License-Identifier: Apache-2.0
"""Who the caller is.

The bearer on a request is verified here and nowhere else. Under edge it is
the zone's token, put on the request by the platform's Gateway, minted for the
director; under pkce it is the bundle's own. Both are RS256 tokens from the
configured issuer and both are verified the same way: signature against the
issuer's published keys, issuer, expiry, and the audience this component was
told to require. Nothing about the mode changes the verification, only who
put the header there.

What this does not do is decide what the caller may do. That is the director's
answer, obtained by relaying the same token (see director.py). This module
establishes who is asking; it grants nothing.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from gentian_app_runtime.tenant import TenantSettings, assert_tenant_access

_bearer = HTTPBearer(auto_error=False)


class AuthSettings(TenantSettings, Protocol):
    """What an app's Settings must answer for this module."""

    oidc_issuer: str | None
    auth_disabled: bool

    @property
    def expected_audience(self) -> str | None: ...


# The issuer's signing keys, cached per issuer. Fetching them on every request
# put a network call to the identity provider on the hot path of every API
# call, and made the identity provider's availability the availability of this
# component. A rotated key that is not in the cache is fetched once more before
# the token is refused, so rotation costs one extra fetch, not an outage.
_JWKS_TTL_SECONDS = 600
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_log = logging.getLogger("gentian.auth")


def _jwks(issuer: str, *, refresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    cached = _jwks_cache.get(issuer)
    if cached and not refresh and now - cached[0] < _JWKS_TTL_SECONDS:
        return cached[1]
    url = issuer.rstrip("/") + "/protocol/openid-connect/certs"
    started = time.monotonic()
    try:
        resp = httpx.get(url, timeout=httpx.Timeout(5.0, connect=3.0))
        resp.raise_for_status()
        keys = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        _log.warning(
            "signing keys of %s not read after %.2fs: %s",
            issuer,
            time.monotonic() - started,
            type(exc).__name__,
        )
        if isinstance(exc, ValueError):
            raise httpx.DecodingError("the signing keys are not JSON") from exc
        raise
    _log.info("signing keys of %s read in %.2fs", issuer, time.monotonic() - started)
    _jwks_cache[issuer] = (now, keys)
    return keys


def _signing_key(issuer: str, kid: str | None):
    for attempt in (False, True):
        keys = _jwks(issuer, refresh=attempt)
        key = next((k for k in keys.get("keys", []) if k.get("kid") == kid), None)
        if key is not None:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")


def decode_token(token: str, settings: AuthSettings) -> dict[str, Any]:
    """Verify a bearer against this component's issuer and audience."""
    issuer = (settings.oidc_issuer or "").rstrip("/")
    header = jwt.get_unverified_header(token)
    public_key = _signing_key(issuer, header.get("kid"))
    audience = settings.expected_audience
    if audience is None and settings.is_edge:
        # Under edge every token of the zone's realm reaches somebody. With
        # no audience to hold one against, this API would accept all of
        # them, including one made out to another app.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This component was not told which audience a token must carry.",
        )
    return jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options={"verify_aud": audience is not None},
    )


def current_user(
    get_settings: Callable[[], AuthSettings],
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """The dependency that answers who the caller is, for an app's settings."""

    async def get_current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> dict[str, Any]:
        settings = get_settings()
        if settings.auth_disabled:
            return {"sub": f"admin-{settings.tenant_id}", "tenant": settings.tenant_id}
        if credentials is None or not credentials.credentials:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
            )
        try:
            claims = decode_token(credentials.credentials, settings)
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            # The identity provider could not be asked for its keys. That is
            # not the caller's fault and not a refusal of the caller: say so.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"The identity provider's signing keys are unavailable: {exc}",
            ) from exc

        tenant = assert_tenant_access(claims, settings)
        claims["tenant"] = tenant
        return claims

    return get_current_user


def bearer_of(credentials: HTTPAuthorizationCredentials | None) -> str:
    """The raw bearer, for relaying to the director as the caller."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="A bearer token is required."
        )
    return credentials.credentials


def session_key(claims: dict[str, Any]) -> str:
    """What an install sequence and the store's rate gate are bound to: the
    person's cluster session.

    The zone's token names the person (`sub`) and the session the identity
    provider holds for them (`sid`). The edge refreshes the token every few
    minutes and both stay the same across a refresh, so the pair names the
    session rather than one token of it. A second sign-in of the same person
    is another `sid` and so another key: it does not find the first one's
    sequences.

    A token with no `sid` is bound to the person alone. That is weaker -- two
    sessions of one person then share what is kept here -- and it is never
    another person's.
    """
    sub = str(claims.get("sub") or "")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="The token names nobody."
        )
    sid = str(claims.get("sid") or "")
    return f"{sub}\n{sid}"
