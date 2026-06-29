"""Regression tests for Admin Console API dependency wiring."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_admin_members_get_does_not_require_body():
    """Protocol-typed Depends must not be parsed as a JSON request body."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/admin/members?tenant=demo")
        assert response.status_code != 422 or "Field required" not in response.text


@pytest.mark.asyncio
async def test_admin_security_policies_get_does_not_require_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/admin/security-policies?tenant=demo")
        assert response.status_code != 422 or "Field required" not in response.text
