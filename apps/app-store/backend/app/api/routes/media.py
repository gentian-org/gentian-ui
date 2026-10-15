"""A store's pictures, from this origin. The rules are in `app.store.media`."""

from fastapi import APIRouter, Depends, Query, Response

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.store import media
from app.store.client import get_store

router = APIRouter(tags=["media"])


@router.get("/media")
async def image(
    u: str = Query(max_length=media.MAX_URL_LENGTH),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    content_type, content = await media.fetch_image(get_store(settings), u)
    return Response(
        content=content,
        media_type=content_type,
        headers={
            # The person's own browser may keep it; nothing between may.
            "Cache-Control": "private, max-age=3600",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )
