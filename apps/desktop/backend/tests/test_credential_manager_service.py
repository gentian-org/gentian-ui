"""prove_write_path — the login-time token exchange.

It exists so that signing in IS the proof gentian-os waits for before it
destroys the installer's bootstrap credential. Everything here is about it
failing quietly: a login must not break because the credential manager is
unreachable, misconfigured, or refusing the caller.
"""

import httpx
import pytest

from app.core.config import Settings
from app.services.credential_manager import prove_write_path


class _Transport(httpx.AsyncBaseTransport):
    def __init__(self, status: int) -> None:
        self.status = status
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json={"items": []})


@pytest.fixture
def patched(monkeypatch):
    def _install(status: int):
        transport = _Transport(status)
        original = httpx.AsyncClient

        def _client(*args, **kwargs):
            kwargs["transport"] = transport
            return original(*args, **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", _client)
        return transport

    return _install


def _settings() -> Settings:
    s = Settings()
    object.__setattr__(s, "credential_manager_url", "http://credmgr.gentian-system.svc:9444")
    return s


@pytest.mark.asyncio
async def test_exchange_succeeds_and_forwards_the_callers_token(patched):
    transport = patched(200)
    assert await prove_write_path("a.jwt.token", _settings()) is True
    assert len(transport.requests) == 1
    request = transport.requests[0]
    assert request.url.path == "/v1/credentials"
    assert request.method == "GET"
    # The CALLER's token, never a service credential — the whole point is that
    # OpenBao records the human.
    assert request.headers["Authorization"] == "Bearer a.jwt.token"


@pytest.mark.asyncio
async def test_a_refused_caller_is_not_proof(patched):
    patched(401)
    assert await prove_write_path("a.jwt.token", _settings()) is False


@pytest.mark.asyncio
async def test_an_unreachable_credential_manager_is_not_an_exception(patched, monkeypatch):
    """The login path calls this. It must never raise."""

    class _Broken(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            raise httpx.ConnectError("connection refused", request=request)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda *a, **k: original(*a, **{**k, "transport": _Broken()})
    )
    assert await prove_write_path("a.jwt.token", _settings()) is False


@pytest.mark.asyncio
async def test_no_url_configured_is_a_quiet_no(patched):
    transport = patched(200)
    assert await prove_write_path("a.jwt.token", Settings()) is False
    assert transport.requests == []


@pytest.mark.asyncio
async def test_no_token_is_a_quiet_no(patched):
    transport = patched(200)
    assert await prove_write_path("", _settings()) is False
    assert transport.requests == []
