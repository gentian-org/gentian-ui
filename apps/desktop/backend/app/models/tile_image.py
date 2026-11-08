"""The pictures a tile is drawn with, beyond the one its profile ships.

Two levels, both kept here and both only presentation: which picture a tile
shows decides nothing about who may open it.

  person  a picture one person chose for one tile on their own desktop, with
          "customize tile". Keyed by the desktop's id of the tile, so it covers
          an app's tile and a link shortcut alike.
  tenant  the App Store's picture for an app, copied here when the App Store
          app installs or updates it. Keyed by the app's profile name.

The third level, the profile's own picture, is in the tile catalog the
cluster projects and is not copied.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Index, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PersonTileRow(Base):
    __tablename__ = "person_tiles"
    __table_args__ = (Index("ix_person_tiles_tenant_user", "tenant", "user_sub"),)

    tenant: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_sub: Mapped[str] = mapped_column(String(128), primary_key=True)
    tile_id: Mapped[str] = mapped_column(String(512), primary_key=True)
    image: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


class TenantTileRow(Base):
    __tablename__ = "tenant_tiles"

    tenant: Mapped[str] = mapped_column(String(128), primary_key=True)
    app: Mapped[str] = mapped_column(String(63), primary_key=True)
    image: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Who copied it, for the record: the subject of the token the App Store
    # app relayed.
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
