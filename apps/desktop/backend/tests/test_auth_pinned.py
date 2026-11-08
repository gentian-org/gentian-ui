"""A token is taken from this desktop's realm, made out to the director."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from gentian_app_runtime import auth as runtime

from app.core import auth
from app.core.config import Settings

OWN = "https://id.desk.gentian.org/auth/realms/acme"
OTHER = "https://id.desk.gentian.org/auth/realms/other"


@pytest.fixture
def signed(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk["kid"] = "k"
    monkeypatch.setattr(runtime, "_jwks", lambda issuer, refresh=False: {"keys": [jwk]})

    def sign(**claims) -> HTTPAuthorizationCredentials:
        body = {"sub": "alice", "iss": OWN, "aud": "gentian-director", "exp": time.time() + 60}
        token = jwt.encode({**body, **claims}, key, algorithm="RS256", headers={"kid": "k"})
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    settings = Settings(
        AUTH_DISABLED="false",
        AUTH_MODE="edge",
        OIDC_ISSUER=OWN,
        OIDC_CLIENT_ID="gentian-edge-acme",
        OIDC_AUDIENCE="gentian-director",
        GENTIAN_TENANT="acme",
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    return sign


async def test_a_token_of_this_realm_is_taken(signed):
    claims = await auth.get_current_user(signed())
    assert claims["sub"] == "alice"
    assert claims["tenant"] == "acme"


async def test_a_token_of_another_realm_on_the_domain_is_refused(signed):
    with pytest.raises(HTTPException) as refused:
        await auth.get_current_user(signed(iss=OTHER, azp="gentian-edge-acme"))
    assert refused.value.status_code == 401


async def test_a_token_made_out_to_another_audience_is_refused(signed):
    with pytest.raises(HTTPException) as refused:
        await auth.get_current_user(signed(aud="something-else", azp="gentian-edge-acme"))
    assert refused.value.status_code == 401
