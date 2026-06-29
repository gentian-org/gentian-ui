"""OpenFGA / AuthZEN PDP client (M22, Stage 1)."""

from typing import Any

import httpx

from app.core.config import Settings


def user_subject(user: dict[str, Any] | str) -> str:
    if isinstance(user, str):
        raw = user.strip()
    else:
        raw = str(user.get("sub") or user.get("preferred_username") or "").strip()
    if not raw:
        return "user:"
    if ":" in raw:
        return raw
    return f"user:{raw}"


class OpenFGAClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._enabled = bool(settings.openfga_api_url and settings.openfga_store_id)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.openfga_api_token:
            headers["Authorization"] = f"Bearer {self._settings.openfga_api_token}"
        return headers

    async def check(
        self,
        *,
        user: str,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        if not self._enabled:
            return True

        url = (
            f"{self._settings.openfga_api_url.rstrip('/')}"
            f"/stores/{self._settings.openfga_store_id}/check"
        )
        payload: dict[str, Any] = {
            "tuple_key": {
                "user": user_subject(user),
                "relation": relation,
                "object": f"{object_type}:{object_id}",
            },
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return bool(resp.json().get("allowed"))
        except httpx.HTTPError:
            # Degraded mode: authz bridge or OpenFGA misconfiguration must not block shell login.
            return True
