"""The store's picture of an app, put on the app's tile on the tenant's desktop.

After an install or an update has rolled out, the picture the store shows for
the app is fetched here -- the way every store picture is (app/store/media.py):
only from a media origin the store's meta lists, only as the image its bytes
say it is -- and handed to the desktop as the tenant's tile for the app
(`PUT /api/v1/tenant-tiles/{app}`), with the person's own token. The desktop
keeps it and serves it from inside the cluster, so drawing the tile fetches
nothing from the store.

Only a PNG is handed on: the desktop draws no other kind of tile.

Nothing here fails the install. The app is installed whether or not its tile
has the store's picture; what came of it is reported beside the rollout, and
a tile without it keeps the profile's own.
"""

from typing import Any

from app.core import director
from app.core.problems import Refusal
from app.store import media

PNG = "image/png"


async def copy_to_desktop(ctx: Any, coordinate: str, profile: str) -> dict[str, Any]:
    """What came of putting the store's picture of `coordinate` on the tile
    of `profile`: `copied`, `no-picture` (the store shows none, or the cluster
    names no desktop) or `failed`, with the refusal that said why."""
    if not ctx.settings.desktop_api_url:
        return {"outcome": "no-picture", "problem": None}
    try:
        catalogue, app = coordinate.split("/", 1)
        detail = await ctx.store.app(catalogue, app, ctx.language)
        if detail.iconUrl is None:
            return {"outcome": "no-picture", "problem": None}
        kind, data = await media.fetch_image(ctx.store, str(detail.iconUrl))
        if kind != PNG:
            raise Refusal(status=415, source="app", code="tile-not-png")
        answer = await director.ask_desktop(
            ctx.settings,
            "PUT",
            f"/api/v1/tenant-tiles/{profile}",
            ctx.cluster_token,
            content=data,
            content_type=PNG,
        )
        if not answer.ok:
            raise answer.refusal()
    except Refusal as refusal:
        return {"outcome": "failed", "problem": refusal.body()["problem"]}
    return {"outcome": "copied", "problem": None}
