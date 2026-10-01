import httpx
import pytest

from app.core.config import Settings
from app.services.keycloak_account import (
    AccountServiceError,
    _totp_is_configured,
    get_profile,
    realm_issuer,
)


def test_realm_issuer_uses_auth_prefix():
    settings = Settings(
        OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/kernel",
        KERNEL_REALM="kernel",
    )
    assert realm_issuer(settings, "demo") == "https://id.desk.gentian.org/auth/realms/demo"


def test_realm_issuer_kernel_from_admin_url():
    settings = Settings(
        KEYCLOAK_ADMIN_URL="http://keycloak.platform-kernel.svc:8080/auth",
        KERNEL_REALM="kernel",
    )
    assert (
        realm_issuer(settings, "kernel")
        == "http://keycloak.platform-kernel.svc:8080/auth/realms/kernel"
    )


@pytest.mark.parametrize(
    ("credentials", "expected"),
    [
        ([], False),
        ([{"type": "password", "userCredentialMetadatas": [{"id": "pw"}]}], False),
        ([{"type": "otp", "userCredentialMetadatas": []}], False),
        ([{"type": "otp", "userCredentials": []}], False),
        ([{"type": "otp", "userCredentialMetadatas": [{"id": "otp-1"}]}], True),
        ([{"type": "otp", "id": "otp-1", "userLabel": "Authenticator"}], True),
    ],
)
def test_totp_is_configured(credentials, expected):
    assert _totp_is_configured(credentials) is expected


@pytest.mark.anyio
async def test_get_profile_requires_accept_json_header(monkeypatch):
    captured: dict[str, str] = {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None):
            captured["accept"] = (headers or {}).get("Accept", "")
            request = httpx.Request("GET", url)
            if url.endswith("/credentials"):
                return httpx.Response(
                    200,
                    json=[
                        {"type": "password", "userCredentialMetadatas": [{"id": "pw"}]},
                        {"type": "otp", "userCredentialMetadatas": []},
                    ],
                    request=request,
                )
            captured["url"] = url
            return httpx.Response(
                200,
                json={
                    "email": "user@example.com",
                    "firstName": "Ada",
                    "lastName": "Lovelace",
                    "username": "ada",
                    "requiredActions": [],
                },
                request=request,
            )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeClient())

    settings = Settings(
        AUTH_DISABLED=False,
        KEYCLOAK_ADMIN_URL="http://keycloak.test/auth",
        OIDC_ISSUER="https://id.example.test/auth/realms/demo",
        KERNEL_REALM="kernel",
        KERNEL_DOMAIN="example.test",
    )
    claims = {
        "iss": "https://id.example.test/auth/realms/demo",
        "email": "user@example.com",
        "preferred_username": "ada",
    }

    profile = await get_profile(token="test-token", claims=claims, settings=settings)

    assert captured["accept"] == "application/json"
    assert captured["url"].endswith("/realms/demo/account/")
    assert profile["email"] == "user@example.com"
    assert profile["firstName"] == "Ada"
    assert profile["totpConfigured"] is False
    assert profile["totpPending"] is False


@pytest.mark.anyio
async def test_get_profile_rejects_html_response(monkeypatch):
    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None):
            request = httpx.Request("GET", url)
            return httpx.Response(
                200,
                text="<!doctype html><html></html>",
                headers={"content-type": "text/html; charset=utf-8"},
                request=request,
            )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: FakeClient())

    settings = Settings(
        AUTH_DISABLED=False,
        KEYCLOAK_ADMIN_URL="http://keycloak.test/auth",
        OIDC_ISSUER="https://id.example.test/auth/realms/demo",
        KERNEL_REALM="kernel",
        KERNEL_DOMAIN="example.test",
    )
    claims = {"iss": "https://id.example.test/auth/realms/demo"}

    with pytest.raises(AccountServiceError, match="unexpected response"):
        await get_profile(token="test-token", claims=claims, settings=settings)
