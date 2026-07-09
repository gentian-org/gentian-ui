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


@pytest.mark.anyio
async def test_custom_prefs_roundtrip_auth_disabled():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Get initial preferences
        get_res = await client.get("/api/v1/prefs/")
        assert get_res.status_code == 200
        assert get_res.json()["customPrefs"] == {}

        # 2. Update preferences
        payload = {"desktopTiles": [{"id": "1", "type": "link", "title": "Test", "position": {"x": 10, "y": 20}}]}
        put_res = await client.put("/api/v1/prefs/", json=payload)
        assert put_res.status_code == 204

        # 3. Verify updated preferences
        get_res2 = await client.get("/api/v1/prefs/")
        assert get_res2.status_code == 200
        assert get_res2.json()["customPrefs"] == payload


@pytest.mark.anyio
async def test_templates_crud_and_apply():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Initially templates list is empty
        list_res = await client.get("/api/v1/prefs/templates")
        assert list_res.status_code == 200
        assert list_res.json() == []

        # 2. Save some preferences for a source user
        payload = {"desktopTiles": [{"id": "tile-1", "type": "link", "title": "Portal", "position": {"x": 100, "y": 100}}]}
        # For simplicity, we are testing in auth_disabled mode where user sub is "anonymous"
        put_res = await client.put("/api/v1/prefs/", json=payload)
        assert put_res.status_code == 204

        # 3. Create template from source user
        create_res = await client.post(
            "/api/v1/prefs/templates",
            json={"name": "Standard Backoffice", "source_user_sub": "dev-user"},
        )
        assert create_res.status_code == 201
        tpl = create_res.json()
        assert tpl["name"] == "Standard Backoffice"
        assert tpl["prefs_json"] == payload
        tpl_id = tpl["id"]

        # 4. List templates should contain the new one
        list_res2 = await client.get("/api/v1/prefs/templates")
        assert list_res2.status_code == 200
        assert len(list_res2.json()) == 1
        assert list_res2.json()[0]["id"] == tpl_id

        # 5. Apply template to another user
        apply_res = await client.post(
            f"/api/v1/prefs/templates/{tpl_id}/apply",
            json={"target_user_sub": "other-user"},
        )
        assert apply_res.status_code == 204

        # 5b. Invite a user with the template ID
        invite_res = await client.post(
            "/api/v1/admin/members/invite",
            json={
                "email": "charlie@demo.desk.gentian.org",
                "firstName": "Charlie",
                "lastName": "Template",
                "settingsTemplateId": tpl_id,
            },
        )
        assert invite_res.status_code == 201
        new_member = invite_res.json()
        new_member_id = new_member["id"]

        # Fetch the newly invited user's preferences to make sure they match the template's
        from app.db.tenant_engine import get_tenant_db_session
        from app.models.user_shell_prefs import UserShellPrefsRow
        with get_tenant_db_session("demo") as db_session:
            row = db_session.get(UserShellPrefsRow, {"user_sub": new_member_id, "tenant": "demo"})
            assert row is not None
            assert row.prefs_json == payload

        # 6. Delete template
        del_res = await client.delete(f"/api/v1/prefs/templates/{tpl_id}")
        assert del_res.status_code == 204

        # 7. List templates should be empty again
        list_res3 = await client.get("/api/v1/prefs/templates")
        assert list_res3.status_code == 200
        assert list_res3.json() == []


