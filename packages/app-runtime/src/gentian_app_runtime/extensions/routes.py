"""Diagnostics for the app's customization surface.

Answers "what is extending this app, and why is this setting what it is" without
anyone needing to exec into a pod — which is the shortest path to a forbidden
cluster hotfix.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter

from gentian_app_runtime.dropins import describe_dropins, dropin_dir
from gentian_app_runtime.extensions.api import EXTENSION_API_VERSION, SUPPORTED_MAJOR_VERSIONS
from gentian_app_runtime.extensions.loader import ExtensionRegistry


def extensions_router(
    registry: Callable[[], ExtensionRegistry], *, dependencies: list[Any]
) -> APIRouter:
    """The route, behind `dependencies`: what is loaded and where it comes
    from is for whoever administers the app, so an app has to say who that is."""
    router = APIRouter(tags=["extensions"], dependencies=dependencies)

    @router.get("/extensions")
    def list_extensions() -> dict:
        """Report loaded plugins, load failures, and applied config drop-ins."""
        return {
            "extensionApi": {
                "version": EXTENSION_API_VERSION,
                "supportedMajors": list(SUPPORTED_MAJOR_VERSIONS),
            },
            "extensions": registry().as_dict(),
            "dropIns": {
                "directory": str(dropin_dir()),
                "applied": describe_dropins(),
            },
        }

    return router
