"""Audit log store — BFF-recorded actions plus optional Keycloak event fetch."""

from __future__ import annotations

from typing import Annotated, Protocol

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.services.admin_store import admin_store_configured
from app.services.audit_events import AuditCategory, AuditEvent, AuditEventFilters
from app.services.keycloak_audit_fetcher import KeycloakAuditFetcher
from app.services.memory_audit_store import MemoryAuditStore
from app.services.sql_audit_store import SqlAuditStore

_memory_audit_store: MemoryAuditStore | None = None
_keycloak_audit_fetcher: KeycloakAuditFetcher | None = None


class BffAuditStore(Protocol):
    async def record(
        self,
        *,
        tenant: str,
        category: AuditCategory,
        action: str,
        actor: str | None,
        target: str | None = None,
        ip_address: str | None = None,
        success: bool = True,
        details: dict[str, str] | None = None,
    ) -> AuditEvent: ...

    async def list_events(self, tenant: str, filters: AuditEventFilters) -> list[AuditEvent]: ...


class AuditStore(Protocol):
    async def record(
        self,
        *,
        tenant: str,
        category: AuditCategory,
        action: str,
        actor: str | None,
        target: str | None = None,
        ip_address: str | None = None,
        success: bool = True,
        details: dict[str, str] | None = None,
    ) -> AuditEvent: ...

    async def list_events(self, realm: str, tenant: str, filters: AuditEventFilters) -> list[AuditEvent]: ...


class CompositeAuditStore:
    def __init__(self, bff_store: BffAuditStore, keycloak: KeycloakAuditFetcher | None) -> None:
        self._bff = bff_store
        self._keycloak = keycloak

    async def record(
        self,
        *,
        tenant: str,
        category: AuditCategory,
        action: str,
        actor: str | None,
        target: str | None = None,
        ip_address: str | None = None,
        success: bool = True,
        details: dict[str, str] | None = None,
    ) -> AuditEvent:
        return await self._bff.record(
            tenant=tenant,
            category=category,
            action=action,
            actor=actor,
            target=target,
            ip_address=ip_address,
            success=success,
            details=details,
        )

    async def list_events(self, realm: str, tenant: str, filters: AuditEventFilters) -> list[AuditEvent]:
        events = await self._bff.list_events(tenant, filters)
        if self._keycloak is not None:
            try:
                events.extend(await self._keycloak.fetch_events(realm, filters))
            except Exception:
                pass
        events.sort(key=lambda item: item.occurred_at, reverse=True)
        return events[: filters.normalized_limit()]


def _memory_store() -> MemoryAuditStore:
    global _memory_audit_store
    if _memory_audit_store is None:
        _memory_audit_store = MemoryAuditStore()
    return _memory_audit_store


def _bff_audit_store(settings: Settings) -> BffAuditStore:
    return SqlAuditStore()


def get_audit_store(settings: Settings = Depends(get_settings)) -> AuditStore:
    global _keycloak_audit_fetcher
    bff = _bff_audit_store(settings)
    if admin_store_configured(settings):
        if _keycloak_audit_fetcher is None:
            _keycloak_audit_fetcher = KeycloakAuditFetcher(
                base_url=settings.keycloak_admin_url or "",
                username=settings.keycloak_admin_username,
                password=settings.keycloak_admin_password,
            )
        return CompositeAuditStore(bff, _keycloak_audit_fetcher)
    return CompositeAuditStore(bff, None)


AuditStoreDep = Annotated[AuditStore, Depends(get_audit_store)]


def audit_actor(user: dict) -> str:
    return str(
        user.get("preferred_username")
        or user.get("email")
        or user.get("sub")
        or "unknown"
    )
