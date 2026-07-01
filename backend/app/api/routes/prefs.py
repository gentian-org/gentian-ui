from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.tenant import resolve_user_context
from app.services.shell_prefs_store import (
    ALLOWED_BACKGROUND_MIMES,
    clear_background,
    get_background,
    get_summary,
    set_background,
)

router = APIRouter(prefix="/prefs", tags=["prefs"])


@router.get("/")
def get_prefs(user: dict = Depends(get_current_user), settings: Settings = Depends(get_settings)) -> dict:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    summary = get_summary(user_sub, tenant)
    return {
        "base": None,
        "theme": None,
        "hasBackground": summary.has_background,
        "backgroundUrl": f"{settings.api_v1_str}/prefs/background" if summary.has_background else None,
    }


@router.get("/background")
def get_prefs_background(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    stored = get_background(user_sub, tenant)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No custom background")
    data, mime = stored
    return Response(
        content=data,
        media_type=mime,
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.put("/background", status_code=status.HTTP_204_NO_CONTENT)
async def upload_prefs_background(
    file: UploadFile,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    mime = (file.content_type or "").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_BACKGROUND_MIMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a JPEG, PNG, WebP, or GIF image",
        )
    data = await file.read()
    try:
        set_background(user_sub, tenant, data, mime)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/background", status_code=status.HTTP_204_NO_CONTENT)
def delete_prefs_background(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    clear_background(user_sub, tenant)
