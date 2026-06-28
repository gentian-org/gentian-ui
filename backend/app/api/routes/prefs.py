from fastapi import APIRouter, Depends

from app.core.auth import get_current_user

router = APIRouter(prefix="/prefs", tags=["prefs"])


@router.get("/")
def get_prefs(user: dict = Depends(get_current_user)) -> dict:
    """Per-user shell preferences. Postgres persistence comes in M3."""
    _ = user
    return {
        "base": None,
        "theme": None,
        "hasBackground": False,
        "backgroundUrl": None,
    }
