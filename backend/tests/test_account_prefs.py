import io

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_account_profile_auth_disabled():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/account/")
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "dev@gentian.local"
    assert body["firstName"] == "Dev"


@pytest.mark.anyio
async def test_prefs_background_roundtrip_auth_disabled():
    transport = ASGITransport(app=app)
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        prefs = await client.get("/api/v1/prefs/")
        assert prefs.status_code == 200
        assert prefs.json()["hasBackground"] is False

        upload = await client.put(
            "/api/v1/prefs/background",
            files={"file": ("wall.png", io.BytesIO(png), "image/png")},
        )
        assert upload.status_code == 204

        prefs2 = await client.get("/api/v1/prefs/")
        assert prefs2.json()["hasBackground"] is True

        image = await client.get("/api/v1/prefs/background")
        assert image.status_code == 200
        assert image.headers["content-type"].startswith("image/png")

        delete = await client.delete("/api/v1/prefs/background")
        assert delete.status_code == 204


@pytest.mark.anyio
async def test_forgot_password_auth_disabled():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nobody@demo.desk.gentian.org"},
        )
    assert response.status_code == 204
