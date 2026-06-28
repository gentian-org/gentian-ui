from fastapi import APIRouter, Depends

from app.core.auth import get_current_user

router = APIRouter(prefix="/apps", tags=["apps"])


@router.get("/")
def list_apps(user: dict = Depends(get_current_user)) -> dict:
    """Installed tenant apps for the shell launcher. K8s/AppProfile wiring comes in M2."""
    _ = user
    return {
        "apps": [
            {
                "id": "settings",
                "title": "Settings",
                "icon": "settings",
                "launchUrl": None,
                "builtin": True,
            },
        ],
    }
