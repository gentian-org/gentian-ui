from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.authz import require_shell_launch
from app.core.config import Settings, get_settings
from app.core.shell_apps import shell_apps_for_user

router = APIRouter(prefix="/apps", tags=["apps"])


@router.get("/")
def list_apps(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    _authz: dict = Depends(require_shell_launch()),
) -> dict:
    return {"apps": shell_apps_for_user(user, settings)}
