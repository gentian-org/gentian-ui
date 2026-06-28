from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.db.session import get_tenant_session

router = APIRouter(prefix="/prefs", tags=["prefs"])


@router.get("/")
def get_prefs(user: dict = Depends(get_current_user)) -> dict:
    """Per-user shell preferences. Postgres persistence comes in M3."""
    settings = get_settings()
    tenant_id = user.get("tenant") or settings.kernel_domain

    with get_tenant_session(tenant_id, settings) as db:
        _ = db.query(dict, user_id=user.get("sub"))

    return {
        "base": None,
        "theme": None,
        "hasBackground": False,
        "backgroundUrl": None,
    }
