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


@pytest.mark.asyncio
async def test_admin_sessions_in_auth_disabled_mode():
    from app.core.config import get_settings
    from app.services.admin_store import get_admin_store
    from app.services.memory_admin_store import MemoryAdminStore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/admin/members",
            json={"email": "eve@demo.desk.gentian.org", "enabled": True},
        )
        assert created.status_code == 201
        member_id = created.json()["id"]

        empty = await client.get("/api/v1/admin/sessions")
        assert empty.status_code == 200
        assert empty.json() == []

        store = get_admin_store(get_settings())
        assert isinstance(store, MemoryAdminStore)
        store.seed_member_session("demo", member_id, client_name="gentian-portal")

        listed = await client.get("/api/v1/admin/sessions")
        assert listed.status_code == 200
        sessions = listed.json()
        assert len(sessions) == 1
        session_id = sessions[0]["id"]

        revoked = await client.delete(f"/api/v1/admin/members/{member_id}/sessions/{session_id}")
        assert revoked.status_code == 204
        assert (await client.get("/api/v1/admin/sessions")).json() == []

        store.seed_member_session("demo", member_id)
        store.seed_member_session("demo", member_id, client_name="other-client")
        assert len((await client.get("/api/v1/admin/sessions")).json()) == 2

        sign_out = await client.post(f"/api/v1/admin/members/{member_id}/sessions/revoke-all")
        assert sign_out.status_code == 204
        assert (await client.get("/api/v1/admin/sessions")).json() == []

        store.seed_member_session("demo", member_id)
        disabled = await client.patch(
            f"/api/v1/admin/members/{member_id}",
            json={"enabled": False},
        )
        assert disabled.status_code == 200
        assert (await client.get("/api/v1/admin/sessions")).json() == []


@pytest.mark.asyncio
async def test_admin_audit_events_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/api/v1/admin/members",
            json={"email": "frank@demo.desk.gentian.org", "enabled": True},
        )
        assert created.status_code == 201
        member_id = created.json()["id"]

        listed = await client.get("/api/v1/admin/audit-events")
        assert listed.status_code == 200
        events = listed.json()
        assert any(event["action"] == "member.created" for event in events)

        filtered = await client.get(
            "/api/v1/admin/audit-events",
            params={"action": "member.created", "category": "admin_action"},
        )
        assert filtered.status_code == 200
        assert all(item["category"] == "admin_action" for item in filtered.json())

        export_csv = await client.get(
            "/api/v1/admin/audit-events/export",
            params={"format": "csv"},
        )
        assert export_csv.status_code == 200
        assert "member.created" in export_csv.text

        await client.delete(f"/api/v1/admin/members/{member_id}")
        after_delete = await client.get("/api/v1/admin/audit-events")
        assert any(event["action"] == "member.deleted" for event in after_delete.json())


@pytest.mark.asyncio
async def test_admin_notifications_in_auth_disabled_mode():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        published = await client.post(
            "/api/v1/admin/notifications",
            params={"tenant": "demo"},
            json={
                "title": "Scheduled maintenance",
                "body": "Portal will restart at 02:00 UTC.",
                "severity": "warning",
                "audience": {"scope": "platform"},
            },
        )
        assert published.status_code == 201
        payload = published.json()
        assert payload["title"] == "Scheduled maintenance"
        assert payload["cloudEvent"]["type"] == "gentian.admin.notification.published.v1"
        notification_id = payload["id"]

        listed = await client.get("/api/v1/admin/notifications", params={"tenant": "demo"})
        assert listed.status_code == 200
        assert any(item["id"] == notification_id for item in listed.json())

        inbox = await client.get("/api/v1/notifications/inbox")
        assert inbox.status_code == 200
        assert any(item["id"] == notification_id for item in inbox.json())

        dismissed = await client.post(f"/api/v1/notifications/{notification_id}/dismiss")
        assert dismissed.status_code == 204
        assert not any(item["id"] == notification_id for item in (await client.get("/api/v1/notifications/inbox")).json())

        audit = await client.get("/api/v1/admin/audit-events", params={"action": "notification.published"})
        assert audit.status_code == 200
        assert any(event["action"] == "notification.published" for event in audit.json())
