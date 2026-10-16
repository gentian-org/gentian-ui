"""Tile pictures: what is accepted, where it is kept, and which one a tile shows.

What is accepted
----------------
Raster images only, judged by their bytes and never by a name or a declared
type alone. An SVG is refused at every level: it is a document a browser runs,
and a tile is drawn on the desktop every member has open.

* A tenant's tile (the App Store's) is a PNG: the signature, then an IHDR
  chunk whose width and height are equal and at most MAX_TILE_SIDE.
* A person's tile is a PNG, JPEG or WebP whose bytes are what its declared
  type says.
* Either is at most MAX_TILE_BYTES.

Which one a tile shows
----------------------
The most specific: the person's own, else the tenant's for the app the tile
is the main entry of, else the profile's own picture from the catalogue.
"""

from __future__ import annotations

import re
import struct
import time
from dataclasses import dataclass

from sqlalchemy import delete, select

from app.db.tenant_engine import get_tenant_db_session
from app.models.tile_image import PersonTileRow, TenantTileRow

MAX_TILE_BYTES = 1024 * 1024
MAX_TILE_SIDE = 1024

PNG = "image/png"
PERSON_TILE_TYPES = ("image/png", "image/jpeg", "image/webp")

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# An app's profile name, as the director spells one.
APP_NAME = r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"
_APP_NAME = re.compile(APP_NAME)

# The desktop's id of a tile: an app tile's is "kernel-" and the catalogue's
# name (<tenant>/<component>/<entry>), a link shortcut's is a UUID.
TILE_ID = r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$"

# The exposure names that make a tile an app's main entry: "web" is what the
# platform calls a component's own host, "link" is the tile of an app that
# runs nothing and leads elsewhere.
MAIN_ENTRIES = ("web", "link")


class TileRefused(ValueError):
    """Why a picture is not taken, and the status that says so."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def sniff(data: bytes) -> str | None:
    """What the bytes are, from how they begin."""
    if data.startswith(_PNG_SIGNATURE):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def png_size(data: bytes) -> tuple[int, int] | None:
    """Width and height from a PNG's IHDR, which the format puts first."""
    if len(data) < 33 or not data.startswith(_PNG_SIGNATURE):
        return None
    length, kind = struct.unpack(">I4s", data[8:16])
    if length != 13 or kind != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def check_tenant_tile(data: bytes) -> None:
    if len(data) > MAX_TILE_BYTES:
        raise TileRefused(413, "A tile is at most 1 MiB")
    size = png_size(data)
    if size is None:
        raise TileRefused(415, "A tenant's tile is a PNG")
    width, height = size
    if width != height or not 0 < width <= MAX_TILE_SIDE:
        raise TileRefused(422, f"A tile is square and at most {MAX_TILE_SIDE} pixels wide")


def check_person_tile(data: bytes, declared: str) -> str:
    """The type a person's picture is, or why it is refused."""
    if len(data) > MAX_TILE_BYTES:
        raise TileRefused(413, "A tile is at most 1 MiB")
    found = sniff(data)
    if declared not in PERSON_TILE_TYPES or found != declared:
        raise TileRefused(415, "Upload a PNG, JPEG or WebP image")
    if found == PNG and png_size(data) is None:
        raise TileRefused(415, "Upload a PNG, JPEG or WebP image")
    return found


def main_app_of(tile_id: str, tenant: str) -> str | None:
    """The app a tile is the main entry of, or None.

    A tenant's tile replaces the picture of one tile per app: its main entry.
    An app's other tiles (an add-on's, a second host's) keep their own.
    """
    name = tile_id.removeprefix("kernel-")
    parts = name.split("/")
    if len(parts) != 3 or parts[0] != tenant or parts[2] not in MAIN_ENTRIES:
        return None
    return parts[1] if _APP_NAME.match(parts[1]) else None


@dataclass
class Picture:
    data: bytes
    mime: str


def _now() -> int:
    return int(time.time())


# ── a person's ──────────────────────────────────────────────────────────────


def set_person_tile(tenant: str, user_sub: str, tile_id: str, data: bytes, mime: str) -> int:
    stamp = _now()
    with get_tenant_db_session(tenant) as session:
        key = {"tenant": tenant, "user_sub": user_sub, "tile_id": tile_id}
        row = session.get(PersonTileRow, key)
        if row is None:
            row = PersonTileRow(**key)
            session.add(row)
        row.image, row.mime, row.updated_at = data, mime, stamp
    return stamp


def clear_person_tile(tenant: str, user_sub: str, tile_id: str) -> None:
    with get_tenant_db_session(tenant) as session:
        session.execute(
            delete(PersonTileRow).where(
                PersonTileRow.tenant == tenant,
                PersonTileRow.user_sub == user_sub,
                PersonTileRow.tile_id == tile_id,
            )
        )


def person_tile(tenant: str, user_sub: str, tile_id: str) -> Picture | None:
    with get_tenant_db_session(tenant) as session:
        row = session.get(
            PersonTileRow, {"tenant": tenant, "user_sub": user_sub, "tile_id": tile_id}
        )
        return Picture(row.image, row.mime) if row else None


# ── a tenant's ──────────────────────────────────────────────────────────────


def set_tenant_tile(tenant: str, app: str, data: bytes, updated_by: str | None) -> None:
    with get_tenant_db_session(tenant) as session:
        row = session.get(TenantTileRow, {"tenant": tenant, "app": app})
        if row is None:
            row = TenantTileRow(tenant=tenant, app=app)
            session.add(row)
        row.image, row.updated_at, row.updated_by = data, _now(), updated_by


def clear_tenant_tile(tenant: str, app: str) -> None:
    with get_tenant_db_session(tenant) as session:
        session.execute(
            delete(TenantTileRow).where(TenantTileRow.tenant == tenant, TenantTileRow.app == app)
        )


def tenant_tile(tenant: str, app: str) -> Picture | None:
    with get_tenant_db_session(tenant) as session:
        row = session.get(TenantTileRow, {"tenant": tenant, "app": app})
        return Picture(row.image, PNG) if row else None


def tenant_tile_versions(tenant: str) -> dict[str, int]:
    """Every app of this tenant that has a tile of the tenant's, and when it
    was set: what the tile list's addresses are versioned by."""
    with get_tenant_db_session(tenant) as session:
        rows = session.execute(
            select(TenantTileRow.app, TenantTileRow.updated_at).where(
                TenantTileRow.tenant == tenant
            )
        ).all()
        return {app: stamp for app, stamp in rows}
