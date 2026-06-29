"""Fetch and normalize Keycloak realm user/admin events for the audit log."""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.services.audit_events import AuditCategory, AuditEvent, AuditEventFilters


class KeycloakAuditFetcher:
    def __init__(self, *, base_url: str, username: str, password: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._token = ""
        self._token_expiry = 0.0
        self._client = httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def fetch_events(self, realm: str, filters: AuditEventFilters) -> list[AuditEvent]:
        params = self._query_params(filters)
        user_events = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/events",
            params=params,
        )
        admin_events = await self._request(
            "GET",
            f"/admin/realms/{quote(realm, safe='')}/admin-events",
            params=params,
        )
        events: list[AuditEvent] = []
        if isinstance(user_events, list):
            for raw in user_events:
                events.append(self._user_event_from_raw(realm, raw))
        if isinstance(admin_events, list):
            for raw in admin_events:
                events.append(self._admin_event_from_raw(realm, raw))
        return self._apply_filters(events, filters)

    @staticmethod
    def _query_params(filters: AuditEventFilters) -> dict[str, str]:
        params: dict[str, str] = {"max": str(filters.normalized_limit())}
        if filters.from_epoch_ms:
            params["dateFrom"] = str(filters.from_epoch_ms)
        if filters.to_epoch_ms:
            params["dateTo"] = str(filters.to_epoch_ms)
        if filters.user:
            params["user"] = filters.user
        return params

    @staticmethod
    def _apply_filters(events: list[AuditEvent], filters: AuditEventFilters) -> list[AuditEvent]:
        user_q = (filters.user or "").strip().lower()
        action_q = (filters.action or "").strip().lower()
        filtered: list[AuditEvent] = []
        for event in events:
            if filters.category and event.category != filters.category:
                continue
            if action_q and action_q not in event.action.lower():
                continue
            if user_q:
                haystack = " ".join(
                    part
                    for part in (event.actor, event.target, event.details.get("subject"))
                    if part
                ).lower()
                if user_q not in haystack:
                    continue
            filtered.append(event)
        filtered.sort(key=lambda item: item.occurred_at, reverse=True)
        return filtered[: filters.normalized_limit()]

    @staticmethod
    def _user_event_from_raw(realm: str, raw: dict[str, Any]) -> AuditEvent:
        event_type = str(raw.get("type") or "UNKNOWN")
        error = raw.get("error")
        details = raw.get("details") or {}
        subject = details.get("username") or details.get("email") or raw.get("userId")
        return AuditEvent(
            id=f"kc-user-{raw.get('time')}-{uuid.uuid4().hex[:8]}",
            occurred_at=int(raw.get("time") or 0),
            category="sign_in",
            action=event_type,
            actor=str(subject) if subject else None,
            target=raw.get("clientId"),
            tenant=realm,
            ip_address=raw.get("ipAddress"),
            success=not bool(error),
            details={
                key: str(value)
                for key, value in details.items()
                if value is not None
            },
        )

    @staticmethod
    def _admin_event_from_raw(realm: str, raw: dict[str, Any]) -> AuditEvent:
        operation = str(raw.get("operationType") or "UNKNOWN")
        resource_type = str(raw.get("resourceType") or "RESOURCE")
        resource_path = str(raw.get("resourcePath") or "")
        error = raw.get("error")
        auth = raw.get("authDetails") or {}
        actor = auth.get("userId") or auth.get("username") or auth.get("clientId")
        category: AuditCategory = "entitlement" if resource_type == "GROUP_MEMBERSHIP" else "admin_action"
        return AuditEvent(
            id=f"kc-admin-{raw.get('time')}-{uuid.uuid4().hex[:8]}",
            occurred_at=int(raw.get("time") or 0),
            category=category,
            action=f"{resource_type}.{operation}",
            actor=str(actor) if actor else None,
            target=resource_path or None,
            tenant=realm,
            ip_address=auth.get("ipAddress"),
            success=not bool(error),
            details={
                "resourceType": resource_type,
                "operationType": operation,
            },
        )

    async def _admin_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 30:
            return self._token
        response = await self._client.post(
            f"{self._base_url}/realms/master/protocol/openid-connect/token",
            data={
                "client_id": "admin-cli",
                "username": self._username,
                "password": self._password,
                "grant_type": "password",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak admin token request failed: {response.text}",
            )
        payload = response.json()
        self._token = payload["access_token"]
        self._token_expiry = time.time() + int(payload.get("expires_in", 60))
        return self._token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
    ) -> Any:
        token = await self._admin_token()
        response = await self._client.request(
            method,
            f"{self._base_url}{path}",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            return []
        if not response.content:
            return []
        return response.json()
