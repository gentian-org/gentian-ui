"""The desktop forwards the person's token to the director and repeats its
answer. These tests are about that and nothing else: the decision is the
director's, and is tested in gentian-os.
"""

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from app.services import director


class FakeDirector:
    """Answers like the director does, and records what it was asked."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 202
        self.body: dict = {"status": "installed", "commit": "abc123"}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/tiles"):
            return httpx.Response(200, json={"cluster": "demo-cluster", "kernelDomain": "k.example",
                                             "tiles": [{"name": "headlamp", "url": "https://headlamp.k.example/"}]})
        if request.url.path.endswith("/apps") and request.method == "GET":
            return httpx.Response(200, json={"tenant": "demo", "apps": [{"profile": "nextcloud", "addons": ["deck"]}]})
        return httpx.Response(self.status, json=self.body, headers={"X-Request-Id": "req-1"})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeDirector()
    transport = httpx.MockTransport(fake.handler)
    original = director._call

    async def call_with_transport(settings, method, path, **kw):
        kw.setdefault("transport", transport)
        return await original(settings, method, path, **kw)

    monkeypatch.setattr(director, "_call", call_with_transport)
    monkeypatch.setenv("DIRECTOR_URL", "http://director.test")
    get_settings.cache_clear()
    yield fake
    get_settings.cache_clear()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_the_persons_own_token_is_forwarded_and_nothing_else(client, fake):
    response = await client.post(
        "/api/v1/director/tenants/demo/apps/element",
        headers={"Authorization": "Bearer person-token", "X-Gentian-Actor": "root"},
    )
    assert response.status_code == 202, response.text
    assert response.json() == {"status": "installed", "commit": "abc123"}
    sent = fake.requests[-1]
    assert sent.headers["Authorization"] == "Bearer person-token"
    assert "X-Gentian-Actor" not in sent.headers
    assert sent.url.path == "/v1/tenants/demo/apps/element"


async def test_no_token_means_no_call(client, fake):
    response = await client.get("/api/v1/director/tenants/demo/apps")
    assert response.status_code == 401
    assert fake.requests == []


async def test_reads_come_back_as_the_director_said(client, fake):
    response = await client.get("/api/v1/director/tenants/demo/apps", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    assert response.json()["apps"] == [{"profile": "nextcloud", "addons": ["deck"]}]


@pytest.mark.parametrize("status", [401, 403, 404, 409])
async def test_a_refusal_is_repeated_with_its_status_and_request_id(client, fake, status):
    fake.status, fake.body = status, {"error": "forbidden", "request_id": "req-1"}
    response = await client.delete(
        "/api/v1/director/tenants/demo/apps/element", headers={"Authorization": "Bearer t"}
    )
    assert response.status_code == status
    assert response.json()["detail"] == "forbidden"
    assert response.headers["X-Request-Id"] == "req-1"


async def test_a_name_that_is_not_one_never_reaches_the_director(client, fake):
    response = await client.get("/api/v1/director/tenants/Demo/apps", headers={"Authorization": "Bearer t"})
    assert response.status_code == 400
    assert fake.requests == []


async def test_an_unconfigured_director_is_reported_not_faked(client, monkeypatch):
    monkeypatch.delenv("DIRECTOR_URL", raising=False)
    get_settings.cache_clear()
    response = await client.get("/api/v1/director/tenants/demo/apps", headers={"Authorization": "Bearer t"})
    assert response.status_code == 503
    assert "DIRECTOR_URL" in response.json()["detail"]


async def test_kernel_tiles_come_from_the_director(client, fake):
    response = await client.get("/api/v1/director/clusters/demo-cluster/tiles", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    assert response.json()["tiles"][0]["name"] == "headlamp"
    assert fake.requests[-1].url.path == "/v1/clusters/demo-cluster/tiles"
