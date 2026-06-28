"""Authorization helpers — see gentian-app-template/backend/app/core/authz.py"""

from typing import Any

from fastapi import Depends, HTTPException, status

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings


async def require_permission(
    relation: str,
    object_type: str,
    object_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    _ = (relation, object_type, object_id, settings)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user
