import io

import httpx
import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.routes import prefs as prefs_routes
from app.core.config import Settings
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

        # No invite-time application any more.
        #
        # This used to invite somebody through the bundled console's
        # /admin/members/invite and assert the template landed on the new
        # account. Inviting is the administration console's now, through the
        # director, so the trigger is gone; templates are applied explicitly,
        # as above. That is a real if small loss, recorded rather than hidden
        # (gentian-os S7A.6).

        # 6. Delete template
        del_res = await client.delete(f"/api/v1/prefs/templates/{tpl_id}")
        assert del_res.status_code == 204

        # 7. List templates should be empty again
        list_res3 = await client.get("/api/v1/prefs/templates")
        assert list_res3.status_code == 200
        assert list_res3.json() == []


def test_frame_ancestors_allows_listed_origin():
    """frame-ancestors is an allow-list, so membership is the question.

    The store publishes
        frame-ancestors 'self' https://portal.gtn.host https://corp.gtn.host ...
    and the portal is named in it. A check that answered on the presence of the
    token "self" called that unembeddable, so the shell opened a browser tab for
    every app that permits the portal alongside itself.
    """
    from app.api.routes.prefs import _frame_ancestors_allows as allows

    store = (
        "frame-ancestors 'self' https://portal.gtn.host "
        "https://corp.gtn.host https://*.corp.gtn.host"
    )
    assert allows(store, "https://corp.gtn.host") is True
    assert allows(store, "https://portal.gtn.host") is True
    assert allows(store, "https://sub.corp.gtn.host") is True

    assert allows(store, "https://evil.example") is False
    assert allows("frame-ancestors 'none'", "https://corp.gtn.host") is False
    assert allows("frame-ancestors 'self'", "https://corp.gtn.host") is False
    assert allows("frame-ancestors http://corp.gtn.host", "https://corp.gtn.host") is False

    assert allows("frame-ancestors *", "https://corp.gtn.host") is True
    assert allows("default-src 'self'", "https://corp.gtn.host") is True
    # Unknown parent origin: only a wildcard is judgeable, so defer to the
    # browser rather than opening a tab nobody asked for.
    assert allows(store, "") is True


TILE = "https://cloud.acme.example/"


def _framing(monkeypatch, tiles, handler=None):
    """The route with `tiles` as the person's catalog and `handler` answering
    what it fetches; a call is recorded, and without a handler it fails."""
    async def catalog(_token, _settings):
        return tiles

    asked: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        assert handler is not None, f"fetched {request.url}"
        return handler(request)

    real = httpx.AsyncClient
    monkeypatch.setattr(prefs_routes, "_catalog", catalog)
    monkeypatch.setattr(
        prefs_routes.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(answer), **kw)
    )
    return asked


async def _check(url: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/api/v1/prefs/check-iframe", params={"url": url})


@pytest.mark.asyncio
async def test_check_iframe_answers_for_a_tile(monkeypatch):
    _framing(monkeypatch, [{"url": TILE}], lambda _r: httpx.Response(200))
    assert (await _check(TILE + "index.php")).json() == {"embeddable": True}


@pytest.mark.asyncio
async def test_check_iframe_says_no_where_the_page_refuses_framing(monkeypatch):
    _framing(
        monkeypatch, [{"url": TILE}], lambda _r: httpx.Response(200, headers={"X-Frame-Options": "DENY"})
    )
    assert (await _check(TILE)).json() == {"embeddable": False}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    ["https://attacker.example/", "http://cloud.acme.example/", "http://10.0.0.1/"],
)
async def test_check_iframe_fetches_only_a_tiles_host(monkeypatch, url):
    asked = _framing(monkeypatch, [{"url": TILE}])
    assert (await _check(url)).status_code == 403
    assert asked == []


@pytest.mark.asyncio
async def test_check_iframe_without_a_catalog_fetches_nothing(monkeypatch):
    asked = _framing(monkeypatch, None)
    assert (await _check(TILE)).status_code == 503
    assert asked == []


@pytest.mark.asyncio
async def test_check_iframe_needs_a_person(monkeypatch):
    from app.core.auth import get_current_user

    asked = _framing(monkeypatch, [{"url": TILE}])

    def nobody():
        raise HTTPException(status_code=401)

    app.dependency_overrides[get_current_user] = nobody
    try:
        assert (await _check(TILE)).status_code == 401
    finally:
        app.dependency_overrides.pop(get_current_user)
    assert asked == []


@pytest.mark.asyncio
async def test_check_iframe_does_not_follow_a_redirect_inside(monkeypatch):
    def redirect(_request):
        return httpx.Response(302, headers={"Location": "https://127.0.0.1/admin"})

    asked = _framing(monkeypatch, [{"url": TILE}], redirect)
    assert (await _check(TILE)).json() == {"embeddable": False}
    assert asked == [TILE]


@pytest.mark.asyncio
async def test_check_iframe_follows_a_redirect_to_the_sign_in_host(monkeypatch):
    """Inside a cluster the sign-in host resolves to the edge's private
    address, like the tiles' hosts."""
    from app.core.config import get_settings

    sign_in = f"https://{get_settings().idp_public_host}/auth"

    def answer(request):
        if str(request.url) == TILE:
            return httpx.Response(302, headers={"Location": sign_in})
        return httpx.Response(200)

    asked = _framing(monkeypatch, [{"url": TILE}], answer)
    assert (await _check(TILE)).json() == {"embeddable": True}
    assert asked == [TILE, sign_in]


@pytest.mark.asyncio
async def test_check_iframe_says_no_when_the_page_cannot_be_reached(monkeypatch):
    def down(request):
        raise httpx.ConnectError("refused", request=request)

    _framing(monkeypatch, [{"url": TILE}], down)
    assert (await _check(TILE)).json() == {"embeddable": False}


def _auth_settings() -> Settings:
    s = Settings(ENVIRONMENT="local", KERNEL_DOMAIN="desk.gentian.org")
    s.auth_disabled = False
    return s


def test_tenant_admins_may_manage_settings_templates():
    """Settings templates are a tenant-admin tool, and the portal JWT carries
    entitlements as `groups`, never as `roles`. Asserted against the guard with
    auth enabled: the CRUD test above runs with auth disabled, where the guard
    returns early and proves nothing."""
    settings = _auth_settings()

    prefs_routes.require_admin({"groups": ["gentian:tenant:demo:admins"]}, settings)  # no raise
    prefs_routes.require_admin({"groups": ["gentian:platform:admin"]}, settings)  # no raise

    member = {"groups": ["gentian:tenant:demo:members"]}
    with pytest.raises(HTTPException) as exc:
        prefs_routes.require_admin(member, settings)
    assert exc.value.status_code == 403
