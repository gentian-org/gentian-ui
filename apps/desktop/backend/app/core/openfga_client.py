"""OpenFGA / AuthZEN PDP client (M22, Stage 1–2)."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings


def parse_subject(subject: str) -> tuple[str, str]:
    """Split an OpenFGA user string into AuthZEN subject type and id."""
    raw = subject.strip()
    if ":" in raw:
        typ, ident = raw.split(":", 1)
        return typ, ident
    return "user", raw


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


def capability_object_id(tenant: str, consumer: str, contract: str, capability: str) -> str:
    cap = capability.replace(":", "-").replace("/", "-")
    return f"{tenant}--{consumer}--{contract}--{cap}"


def installed_app_subject(tenant: str, app: str) -> str:
    return f"installed_app:{tenant}--{app}"


class OpenFGAClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._enabled = bool(settings.openfga_api_url and settings.openfga_store_id)

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def authzen_enabled(self) -> bool:
        return self._enabled and self._settings.openfga_authzen_enabled

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.openfga_api_token:
            headers["Authorization"] = f"Bearer {self._settings.openfga_api_token}"
        return headers

    def _store_base(self) -> str:
        return (
            f"{self._settings.openfga_api_url.rstrip('/')}"
            f"/stores/{self._settings.openfga_store_id}"
        )

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
        if self.authzen_enabled:
            return await self._authzen_evaluation(
                subject=user,
                relation=relation,
                object_type=object_type,
                object_id=object_id,
            )
        return await self._native_check(
            user=user,
            relation=relation,
            object_type=object_type,
            object_id=object_id,
        )

    async def check_tuple(self, *, user: str, relation: str, object_ref: str) -> bool:
        if ":" not in object_ref:
            return False
        object_type, object_id = object_ref.split(":", 1)
        return await self.check(
            user=user,
            relation=relation,
            object_type=object_type,
            object_id=object_id,
        )

    async def evaluations(
        self,
        *,
        subject: str,
        object_type: str,
        object_id: str,
        relations: list[str],
    ) -> dict[str, bool]:
        """Batch-check relations on one object; returns relation -> allowed."""
        if not relations:
            return {}
        if not self._enabled:
            return dict.fromkeys(relations, True)
        if self.authzen_enabled:
            return await self._authzen_evaluations(
                subject=subject,
                object_type=object_type,
                object_id=object_id,
                relations=relations,
            )
        out: dict[str, bool] = {}
        for relation in relations:
            out[relation] = await self._native_check(
                user=subject,
                relation=relation,
                object_type=object_type,
                object_id=object_id,
            )
        return out

    async def _native_check(
        self,
        *,
        user: str,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        url = f"{self._store_base()}/check"
        payload: dict[str, Any] = {
            "tuple_key": {
                "user": user_subject(user) if not user.startswith(("user:", "installed_app:")) else user,
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
            return True

    async def _authzen_evaluation(
        self,
        *,
        subject: str,
        relation: str,
        object_type: str,
        object_id: str,
    ) -> bool:
        url = f"{self._store_base()}/access/v1/evaluation"
        subj_type, subj_id = parse_subject(
            user_subject(subject) if not subject.startswith(("user:", "installed_app:")) else subject
        )
        payload = {
            "subject": {"type": subj_type, "id": subj_id},
            "action": {"name": relation},
            "resource": {"type": object_type, "id": object_id},
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return bool(resp.json().get("decision"))
        except httpx.HTTPError:
            return True

    async def _authzen_evaluations(
        self,
        *,
        subject: str,
        object_type: str,
        object_id: str,
        relations: list[str],
    ) -> dict[str, bool]:
        url = f"{self._store_base()}/access/v1/evaluations"
        subj_type, subj_id = parse_subject(subject)
        payload = {
            "subject": {"type": subj_type, "id": subj_id},
            "resource": {"type": object_type, "id": object_id},
            "evaluations": [{"action": {"name": relation}} for relation in relations],
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                body = resp.json()
                results = body.get("evaluations") or []
                out: dict[str, bool] = {}
                for relation, item in zip(relations, results, strict=False):
                    out[relation] = bool((item or {}).get("decision"))
                return out
        except httpx.HTTPError:
            return dict.fromkeys(relations, True)

    async def capability_grants(
        self,
        *,
        tenant: str,
        consumer_app: str,
        contract: str,
        capabilities: list[str],
    ) -> dict[str, bool]:
        """Check installed_app granted tuples for each capability."""
        if not capabilities:
            return {}
        subject = installed_app_subject(tenant, consumer_app)
        out: dict[str, bool] = {}
        for cap in capabilities:
            obj = f"capability:{capability_object_id(tenant, consumer_app, contract, cap)}"
            out[cap] = await self.check_tuple(user=subject, relation="granted", object_ref=obj)
        return out
