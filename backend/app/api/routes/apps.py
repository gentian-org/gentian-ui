from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.authz import require_shell_launch

router = APIRouter(prefix="/apps", tags=["apps"])


@router.get("/")
def list_apps(user: dict = Depends(get_current_user), _authz: dict = Depends(require_shell_launch())) -> dict:
    """Installed tenant apps for the shell launcher. K8s/AppProfile wiring comes later."""
    _ = user
    return {
        "apps": [
            {
                "id": "mail",
                "title": "Mail",
                "icon": "mail",
                "launchUrl": "https://example.com/mail",
            },
            {
                "id": "chat",
                "title": "Chat",
                "icon": "chat",
                "launchUrl": "https://example.com/chat",
            },
            {
                "id": "files",
                "title": "Files",
                "icon": "files",
                "launchUrl": "https://example.com/files",
            },
            {
                "id": "settings",
                "title": "Settings",
                "icon": "settings",
                "launchUrl": None,
                "builtin": True,
            },
        ],
    }
