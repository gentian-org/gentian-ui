"""Verifying the bearer the edge forwards.

Under edge the platform's Gateway puts the zone's token on the request. That
token is minted for the director and signed by the zone's realm, and this API
must accept exactly that and nothing else: not a token the same realm signed
for some other purpose, not one from another issuer, and not a request with no
bearer at all. What the caller may then do is the director's answer, obtained
by relaying the same token; nothing here grants anything.

The identity provider is stood in for by a key generated here and a JWKS
returned by a patched fetch, so these run with no network.
"""

import asyncio
import time
from dataclasses import dataclass

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from gentian_app_runtime import auth
from gentian_app_runtime.tenant import assert_tenant_access

ISSUER = "https://id.example.test/auth/realms/kernel"
KID = "test-key"


@pytest.fixture(scope="module")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture(autouse=True)
def jwks(keypair, monkeypatch):
    _, public = keypair
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public, as_dict=True)
    jwk["kid"] = KID
    monkeypatch.setattr(auth, "_jwks", lambda issuer, refresh=False: {"keys": [jwk]})
    auth._jwks_cache.clear()


@dataclass
class Settings:
    """The attributes an app's Settings must have."""

    oidc_issuer: str | None = ISSUER
    oidc_client_id: str | None = "gentian-edge-kernel"
    oidc_audience: str | None = "gentian-director"
    auth_disabled: bool = False
    auth_mode: str = "edge"
    tenant_id: str = "platform"
    environment: str = "local"

    @property
    def is_edge(self) -> bool:
        return self.auth_mode == "edge"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def expected_audience(self) -> str | None:
        return self.oidc_audience or self.oidc_client_id


def settings(**over) -> Settings:
    return Settings(**over)


def token(keypair, **claims) -> str:
    private, _ = keypair
    now = int(time.time())
    payload = {
        "iss": ISSUER,
        "sub": "person",
        "aud": "gentian-director",
        "azp": "gentian-edge-kernel",
        "exp": now + 300,
        "iat": now,
        "tenant": "platform",
    }
    payload.update(claims)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return jwt.encode(payload, pem, algorithm="RS256", headers={"kid": KID})


def test_the_zones_token_is_accepted(keypair):
    claims = auth.decode_token(token(keypair), settings())
    assert claims["sub"] == "person"


def test_a_token_for_another_audience_is_refused(keypair):
    """The same realm signs tokens for many purposes. Only the one minted for
    the director is the zone's session; an app's own token or an
    administration console's is not, and is refused here rather than accepted
    as somebody's session."""
    with pytest.raises(jwt.InvalidAudienceError):
        auth.decode_token(
            token(keypair, aud=["realm-management", "account"], azp="security-admin-console"),
            settings(),
        )


def test_a_token_from_another_issuer_is_refused(keypair):
    with pytest.raises(jwt.InvalidIssuerError):
        auth.decode_token(
            token(keypair, iss="https://id.example.test/auth/realms/other"), settings()
        )


def test_an_expired_token_is_refused(keypair):
    with pytest.raises(jwt.ExpiredSignatureError):
        auth.decode_token(token(keypair, exp=int(time.time()) - 10), settings())


def test_without_a_configured_audience_the_client_id_is_required(keypair):
    """A component not told an audience falls back to its client id, so it is
    never the case that any token the realm signed is accepted."""
    s = settings(oidc_audience=None)
    with pytest.raises(jwt.InvalidAudienceError):
        auth.decode_token(token(keypair, aud="something-else"), s)
    claims = auth.decode_token(token(keypair, aud="gentian-edge-kernel"), s)
    assert claims["azp"] == "gentian-edge-kernel"


def test_an_unknown_signing_key_is_refused_after_one_refresh(keypair, monkeypatch):
    """A rotated key that is not in the cache costs one extra fetch, not an
    outage; a key the issuer never published is refused."""
    calls = []

    def fetch(issuer, refresh=False):
        calls.append(refresh)
        return {"keys": []}

    monkeypatch.setattr(auth, "_jwks", fetch)
    with pytest.raises(HTTPException) as refused:
        auth.decode_token(token(keypair), settings())
    assert refused.value.status_code == 401
    assert calls == [False, True]


def test_bearer_of_refuses_an_absent_header():
    with pytest.raises(HTTPException) as refused:
        auth.bearer_of(None)
    assert refused.value.status_code == 401


def test_under_edge_the_tenant_is_the_platforms_not_the_tokens(keypair):
    """The zone's token carries no tenant claim, and in production the pkce
    rule would refuse it as missing one. Under edge the component is in the
    tenant the platform put it in, and the edge decided entry."""
    s = settings(environment="production", tenant_id="acme")
    claims = auth.decode_token(token(keypair, tenant=None), s)
    claims.pop("tenant", None)
    assert "tenant" not in claims
    assert assert_tenant_access(claims, s) == "acme"


def test_under_pkce_a_mismatched_tenant_claim_is_still_refused():
    s = settings(auth_mode="pkce", tenant_id="acme")
    with pytest.raises(HTTPException) as refused:
        assert_tenant_access({"tenant": "other"}, s)
    assert refused.value.status_code == 403


def test_under_edge_a_component_told_no_audience_accepts_nothing(keypair):
    s = settings(oidc_audience=None, oidc_client_id=None)
    with pytest.raises(HTTPException) as refused:
        auth.decode_token(token(keypair), s)
    assert refused.value.status_code == 503


def _ask(s: Settings, bearer: str | None) -> dict:
    credentials = (
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=bearer) if bearer else None
    )
    return asyncio.run(auth.current_user(lambda: s)(credentials))


def test_current_user_needs_a_bearer():
    with pytest.raises(HTTPException) as refused:
        _ask(settings(), None)
    assert refused.value.status_code == 401


def test_current_user_needs_a_bearer_whatever_the_issuer_says():
    """An unset issuer never makes anybody a user."""
    with pytest.raises(HTTPException) as refused:
        _ask(settings(oidc_issuer=None), None)
    assert refused.value.status_code == 401


def test_current_user_names_the_tenant_the_platform_says(keypair):
    assert _ask(settings(tenant_id="acme"), token(keypair))["tenant"] == "acme"


def test_a_failed_verification_is_refused_as_such(keypair):
    with pytest.raises(HTTPException) as refused:
        _ask(settings(), token(keypair, aud="something-else"))
    assert refused.value.status_code == 401


def test_only_auth_disabled_stands_in_a_user():
    assert _ask(settings(auth_disabled=True, tenant_id="acme"), None)["sub"] == "admin-acme"


def test_keys_that_cannot_be_read_are_not_the_callers_fault(keypair, monkeypatch):
    def down(issuer, refresh=False):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(auth, "_jwks", down)
    with pytest.raises(HTTPException) as refused:
        _ask(settings(), token(keypair))
    assert refused.value.status_code == 503


def test_session_key_is_the_person_and_their_session():
    assert auth.session_key({"sub": "ada", "sid": "s1"}) == "ada\ns1"
    with pytest.raises(HTTPException):
        auth.session_key({})
