import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_admin_members_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/admin/members",
            json={
                "email": "alice@demo.desk.gentian.org",
                "firstName": "Alice",
                "lastName": "Example",
                "enabled": True,
            },
        )
        assert response.status_code == 201
        member = response.json()
        assert member["email"] == "alice@demo.desk.gentian.org"

        listed = await client.get("/api/v1/admin/members")
        assert listed.status_code == 200
        assert any(m["id"] == member["id"] for m in listed.json())


@pytest.mark.asyncio
async def test_admin_invite_member_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/admin/members/invite",
            json={
                "email": "bob@demo.desk.gentian.org",
                "firstName": "Bob",
                "lastName": "Invite",
                "inviteEmail": "bob-recovery@demo.desk.gentian.org",
            },
        )
        assert response.status_code == 201
        member = response.json()
        assert member["email"] == "bob@demo.desk.gentian.org"
        assert member["inviteEmail"] == "bob-recovery@demo.desk.gentian.org"

        reset = await client.post(f"/api/v1/admin/members/{member['id']}/reset-password")
        assert reset.status_code == 204


@pytest.mark.asyncio
async def test_admin_totp_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/admin/members",
            json={"email": "carol@demo.desk.gentian.org", "enabled": True},
        )
        assert created.status_code == 201
        member_id = created.json()["id"]

        enabled = await client.post(
            f"/api/v1/admin/members/{member_id}/totp/enable",
            json={"sendEmail": False},
        )
        assert enabled.status_code == 200
        payload = enabled.json()
        assert payload["totpPending"] is True
        assert payload["totpConfigured"] is False

        removed = await client.delete(f"/api/v1/admin/members/{member_id}/totp")
        assert removed.status_code == 200
        assert removed.json()["totpPending"] is False

        invite = await client.post(
            "/api/v1/admin/members/invite",
            json={
                "email": "dana@demo.desk.gentian.org",
                "requireTotp": True,
            },
        )
        assert invite.status_code == 201
        assert invite.json()["totpPending"] is True


@pytest.mark.asyncio
async def test_admin_security_policies_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        defaults = await client.get("/api/v1/admin/security-policies")
        assert defaults.status_code == 200
        assert defaults.json()["passwordMinLength"] == 8

        updated = await client.put(
            "/api/v1/admin/security-policies",
            json={
                **defaults.json(),
                "passwordMinLength": 12,
                "passwordRequireDigits": True,
                "requireTotpAdmins": True,
            },
        )
        assert updated.status_code == 200
        payload = updated.json()
        assert payload["passwordMinLength"] == 12
        assert payload["passwordRequireDigits"] is True
        assert payload["requireTotpAdmins"] is True
