"""The pictures tiles are drawn with.

What is checked: who may set a tenant's tile (a verified token whose holder
may install apps here, and nobody named by a header), which bytes are taken
(PNG for the tenant, PNG, JPEG or WebP for a person, never SVG, never more
than 1 MiB), and which picture a tile shows (the person's, else the tenant's
for the app's main tile, else the profile's own).
"""

import base64
import struct
import zlib

import httpx
import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster, tiles
from app.core import auth
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

TENANT = "acme"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def png(width: int = 128, height: int | None = None) -> bytes:
    """A real PNG of one color, as small as the format allows."""
    height = width if height is None else height

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + b"\x26\x26\x96" * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


PNG = png()
OTHER_PNG = png(64)


def _settings(**over) -> Settings:
    values = {
        "AUTH_DISABLED": "false",
        "KERNEL_DOMAIN": "desk.gentian.org",
        "USHER_URL": "http://usher.test:8080",
        "GENTIAN_TENANT": TENANT,
    }
    values.update(over)
    return Settings(**{k: v for k, v in values.items() if v is not None})


class Person:
    """Who the tests say is asking. Replaces token verification only in the
    tests that are not about it."""

    def __init__(self) -> None:
        self.sub = "alice"
        self.relations: dict[str, bool] = {"can_enter": True, "can_install_app": True}

    def __call__(self) -> dict:
        return {"sub": self.sub, "tenant": TENANT, "relations": dict(self.relations)}


@pytest.fixture
def usher(monkeypatch):
    """The usher's tile list, as the desktop is answered it."""
    state = {
        "tiles": [
            {"name": f"{TENANT}/nextcloud/web", "displayName": "Nextcloud", "url": "https://n",
             "description": "", "icon": "data:image/png;base64," + base64.b64encode(OTHER_PNG).decode()},
            {"name": f"{TENANT}/nextcloud/collabora", "displayName": "Office", "url": "https://c",
             "description": "", "icon": "data:image/png;base64," + base64.b64encode(OTHER_PNG).decode()},
            # Add-ons: their tiles open inside Nextcloud's host, and they have
            # no main entry of their own. Calendar has one tile, Office two.
            {"name": f"{TENANT}/nextcloud-calendar/calendar", "displayName": "Calendar",
             "url": "https://n/c", "description": "", "icon": "calendar"},
            {"name": f"{TENANT}/nextcloud-office/document", "displayName": "Document",
             "url": "https://n/d", "description": "", "icon": "document"},
            {"name": f"{TENANT}/nextcloud-office/spreadsheet", "displayName": "Spreadsheet",
             "url": "https://n/s", "description": "", "icon": "spreadsheet"},
            {"name": f"{TENANT}/legacy/web", "displayName": "Legacy", "url": "https://l",
             "description": "", "icon": "data:image/svg+xml;base64," + base64.b64encode(SVG).decode()},
            {"name": "headlamp", "displayName": "Headlamp", "url": "https://h",
             "description": "", "icon": "kube"},
        ]
    }

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            assert url == f"http://usher.test:8080/v1/tenants/{TENANT}/tiles"
            return httpx.Response(
                200, json={"tenant": TENANT, "tiles": state["tiles"]},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    return state


@pytest.fixture
def person() -> Person:
    return Person()


@pytest.fixture
def client(person, usher) -> TestClient:
    app = FastAPI()
    app.include_router(tiles.router, prefix="/api/v1")
    app.include_router(cluster.router, prefix="/api/v1")
    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_current_user] = person
    return TestClient(app, follow_redirects=False)


BEARER = {"Authorization": "Bearer person-token"}


def put_tenant(client, app="nextcloud", body=PNG, content_type="image/png"):
    return client.put(
        f"/api/v1/tenant-tiles/{app}",
        content=body,
        headers={**BEARER, "Content-Type": content_type},
    )


def put_person(client, tile="kernel-acme/nextcloud/web", body=PNG, content_type="image/png"):
    return client.put(
        f"/api/v1/person-tiles/{tile}",
        content=body,
        headers={**BEARER, "Content-Type": content_type},
    )


# ── who may set a tenant's tile ─────────────────────────────────────────────


def test_a_person_who_may_install_apps_sets_the_tenants_tile(client):
    assert put_tenant(client).status_code == 204
    answer = client.get("/api/v1/tiles/kernel-acme/nextcloud/web", headers=BEARER)
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "image/png"
    assert answer.content == PNG


@pytest.mark.parametrize("relations", [{}, {"can_enter": True, "can_administer": True}])
def test_a_person_who_may_not_install_apps_may_not_set_or_remove_it(client, person, relations):
    person.relations = relations
    assert put_tenant(client).status_code == 403
    assert client.delete("/api/v1/tenant-tiles/nextcloud", headers=BEARER).status_code == 403


@pytest.fixture
def verifying(monkeypatch, usher):
    """The real `get_current_user`, with token verification and the director
    stood in for, so what is checked is what the route does with them."""
    process = _settings(OIDC_ISSUER="https://id.desk.gentian.org/auth/realms/acme")
    monkeypatch.setattr(auth, "get_settings", lambda: process)
    seen: dict = {"relations": {"can_install_app": True}}

    def decode(token, settings):
        if token != "signed-token":
            raise jwt.InvalidSignatureError("Signature verification failed")
        return {"sub": "alice", "iss": process.oidc_issuer}

    async def relations(token, settings):
        seen["token"] = token
        return seen["relations"]

    monkeypatch.setattr(auth, "_decode_token", decode)
    monkeypatch.setattr(auth, "fetch_tenant_relations", relations)

    app = FastAPI()
    app.include_router(tiles.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: process
    return TestClient(app), seen


def test_the_token_is_verified_and_the_director_asked_with_it(verifying):
    client, seen = verifying
    answer = client.put(
        "/api/v1/tenant-tiles/nextcloud",
        content=PNG,
        headers={"Authorization": "Bearer signed-token", "Content-Type": "image/png"},
    )
    assert answer.status_code == 204
    assert seen["token"] == "signed-token"

    seen["relations"] = {"can_enter": True}
    answer = client.put(
        "/api/v1/tenant-tiles/nextcloud",
        content=PNG,
        headers={"Authorization": "Bearer signed-token", "Content-Type": "image/png"},
    )
    assert answer.status_code == 403


def test_no_token_or_a_bad_one_is_refused_whatever_the_headers_say(verifying):
    client, _ = verifying
    identity = {
        "X-Forwarded-User": "alice",
        "X-Auth-Request-User": "alice",
        "X-Gentian-Subject": "alice",
        "Content-Type": "image/png",
    }
    assert client.put("/api/v1/tenant-tiles/nextcloud", content=PNG, headers=identity).status_code == 401
    answer = client.put(
        "/api/v1/tenant-tiles/nextcloud",
        content=PNG,
        headers={**identity, "Authorization": "Bearer forged-token"},
    )
    assert answer.status_code == 401


# ── which bytes a tenant's tile may be ──────────────────────────────────────


def test_an_svg_is_refused_whatever_it_is_sent_as(client):
    assert put_tenant(client, body=SVG).status_code == 415
    assert put_tenant(client, body=SVG, content_type="image/svg+xml").status_code == 415
    assert put_tenant(client, body=PNG, content_type="image/svg+xml").status_code == 415


def test_a_tenants_tile_is_a_png_and_only_a_png(client):
    assert put_tenant(client, body=JPEG, content_type="image/png").status_code == 415
    # The signature alone is not a PNG: the IHDR has to follow it.
    assert put_tenant(client, body=b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).status_code == 415


def test_a_tenants_tile_is_square_and_at_most_1024_pixels(client):
    assert put_tenant(client, body=png(128, 64)).status_code == 422
    assert put_tenant(client, body=png(2048)).status_code == 422
    assert put_tenant(client, body=png(1024)).status_code == 204


def test_a_tile_larger_than_1_mib_is_refused(client):
    big = PNG + b"\x00" * (1024 * 1024)
    assert put_tenant(client, body=big).status_code == 413
    assert put_person(client, body=big).status_code == 413


def test_the_app_is_named_as_a_profile_is(client):
    assert put_tenant(client, app="Next_Cloud").status_code == 422


# ── a person's own ──────────────────────────────────────────────────────────


def test_a_person_uploads_a_png_or_a_jpeg_and_is_told_where_it_is(client):
    answer = put_person(client)
    assert answer.status_code == 200
    assert answer.json()["url"].startswith("/api/v1/tiles/kernel-acme/nextcloud/web?v=p")
    assert put_person(client, tile="7b0c1e2a-link", body=JPEG, content_type="image/jpeg").status_code == 200
    shown = client.get("/api/v1/tiles/7b0c1e2a-link", headers=BEARER)
    assert shown.headers["content-type"] == "image/jpeg"


def test_a_person_may_not_upload_an_svg(client):
    assert put_person(client, body=SVG, content_type="image/svg+xml").status_code == 415
    # Nor one sent under another name: the bytes decide.
    assert put_person(client, body=SVG, content_type="image/png").status_code == 415
    assert put_person(client, body=JPEG, content_type="image/png").status_code == 415


def test_a_persons_tile_is_theirs_alone(client, person):
    put_person(client, body=PNG)
    person.sub = "bob"
    answer = client.get("/api/v1/tiles/kernel-acme/nextcloud/web", headers=BEARER)
    # Bob sees the profile's own picture, not Alice's.
    assert answer.content == OTHER_PNG


# ── which one a tile shows ──────────────────────────────────────────────────


def test_the_person_wins_over_the_tenant_and_the_tenant_over_the_profile(client):
    tile = "/api/v1/tiles/kernel-acme/nextcloud/web"
    assert client.get(tile, headers=BEARER).content == OTHER_PNG

    put_tenant(client, body=PNG)
    assert client.get(tile, headers=BEARER).content == PNG

    mine = png(32)
    put_person(client, body=mine)
    assert client.get(tile, headers=BEARER).content == mine

    client.delete("/api/v1/person-tiles/kernel-acme/nextcloud/web", headers=BEARER)
    assert client.get(tile, headers=BEARER).content == PNG

    client.delete("/api/v1/tenant-tiles/nextcloud", headers=BEARER)
    assert client.get(tile, headers=BEARER).content == OTHER_PNG


def test_the_tenants_tile_replaces_only_the_apps_main_tile(client):
    put_tenant(client, body=PNG)
    other = client.get("/api/v1/tiles/kernel-acme/nextcloud/collabora", headers=BEARER)
    assert other.content == OTHER_PNG


def test_an_addon_with_one_tile_shows_the_tenants_picture_of_the_addon(client):
    # Before the App Store has given the add-on its picture, its glyph.
    tile = "/api/v1/tiles/kernel-acme/nextcloud-calendar/calendar"
    assert client.get(tile, headers=BEARER).headers["location"] == "/tiles/calendar.png"

    put_tenant(client, app="nextcloud-calendar", body=PNG)
    assert client.get(tile, headers=BEARER).content == PNG
    # Its base keeps its own.
    assert client.get("/api/v1/tiles/kernel-acme/nextcloud/web", headers=BEARER).content == OTHER_PNG


def test_an_addon_with_several_tiles_keeps_each_tiles_own_picture(client):
    # One picture on Document and Spreadsheet alike would make them
    # indistinguishable.
    put_tenant(client, app="nextcloud-office", body=PNG)
    for entry in ("document", "spreadsheet"):
        tile = f"/api/v1/tiles/kernel-acme/nextcloud-office/{entry}"
        assert client.get(tile, headers=BEARER).headers["location"] == f"/tiles/{entry}.png"


def test_the_tile_list_names_this_apis_address_for_an_addons_picture(client):
    put_tenant(client, app="nextcloud-calendar", body=PNG)
    put_tenant(client, app="nextcloud-office", body=PNG)
    listed = client.get("/api/v1/cluster/tiles", headers=BEARER).json()["tiles"]
    icons = {t["name"]: t["icon"] for t in listed}
    assert icons[f"{TENANT}/nextcloud-calendar/calendar"].startswith(
        "/api/v1/tiles/kernel-acme/nextcloud-calendar/calendar?v=t"
    )
    for entry in ("document", "spreadsheet"):
        assert icons[f"{TENANT}/nextcloud-office/{entry}"] == entry
    assert icons[f"{TENANT}/nextcloud/web"].startswith("data:image/png;base64,")


def test_a_profile_picture_that_is_an_svg_is_never_served(client):
    assert client.get("/api/v1/tiles/kernel-acme/legacy/web", headers=BEARER).status_code == 404


def test_a_glyph_is_the_desktops_own_png(client):
    answer = client.get("/api/v1/tiles/kernel-headlamp", headers=BEARER)
    assert answer.status_code == 307
    assert answer.headers["location"] == "/tiles/kube.png"


def test_the_tile_list_names_this_apis_address_for_a_tenants_picture(client):
    put_tenant(client, body=PNG)
    listed = client.get("/api/v1/cluster/tiles", headers=BEARER).json()["tiles"]
    icons = {t["name"]: t["icon"] for t in listed}
    assert icons[f"{TENANT}/nextcloud/web"].startswith("/api/v1/tiles/kernel-acme/nextcloud/web?v=t")
    # The other tiles are the usher's answer as it came.
    assert icons[f"{TENANT}/nextcloud/collabora"].startswith("data:image/png;base64,")
    assert icons["headlamp"] == "kube"
