"""Admin Console identity store abstraction (Keycloak or in-memory dev)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from fastapi import HTTPException, status

from app.core.config import Settings


INVITE_EMAIL_ATTR = "gentian.inviteEmail"
CONFIGURE_TOTP_ACTION = "CONFIGURE_TOTP"


@dataclass
class Member:
    id: str
    username: str
    email: str | None
    first_name: str | None
    last_name: str | None
    enabled: bool
    groups: list[str] = field(default_factory=list)
    invite_email: str | None = None
    totp_configured: bool = False
    totp_pending: bool = False


@dataclass
class Group:
    id: str
    name: str
    path: str
    member_count: int = 0


class AdminStore(Protocol):
    async def list_members(self, realm: str) -> list[Member]: ...

    async def get_member(self, realm: str, member_id: str) -> Member: ...

    async def create_member(
        self,
        realm: str,
        *,
        username: str,
        email: str,
        first_name: str | None,
        last_name: str | None,
        enabled: bool,
    ) -> Member: ...

    async def invite_member(
        self,
        realm: str,
        *,
        username: str,
        email: str,
        first_name: str | None,
        last_name: str | None,
        invite_email: str | None,
        group_ids: list[str],
        require_totp: bool = False,
    ) -> Member: ...

    async def send_password_reset(self, realm: str, member_id: str) -> None: ...

    async def enable_totp(self, realm: str, member_id: str, *, send_email: bool) -> Member: ...

    async def remove_totp(self, realm: str, member_id: str) -> Member: ...

    async def clear_totp_requirement(self, realm: str, member_id: str) -> None: ...

    async def update_member(
        self,
        realm: str,
        member_id: str,
        *,
        email: str | None,
        first_name: str | None,
        last_name: str | None,
        enabled: bool | None,
    ) -> Member: ...

    async def delete_member(self, realm: str, member_id: str) -> None: ...

    async def list_groups(self, realm: str) -> list[Group]: ...

    async def create_group(self, realm: str, *, name: str) -> Group: ...

    async def get_group(self, realm: str, group_id: str) -> Group: ...

    async def update_group(self, realm: str, group_id: str, *, name: str) -> Group: ...

    async def delete_group(self, realm: str, group_id: str) -> None: ...

    async def add_member_to_group(self, realm: str, member_id: str, group_id: str) -> None: ...

    async def remove_member_from_group(self, realm: str, member_id: str, group_id: str) -> None: ...

    async def set_member_groups(self, realm: str, member_id: str, group_ids: list[str]) -> Member: ...


def admin_store_configured(settings: Settings) -> bool:
    return bool(settings.keycloak_admin_url and settings.keycloak_admin_password)


def get_admin_store(settings: Settings) -> AdminStore:
    from app.services.keycloak_admin_store import KeycloakAdminStore
    from app.services.memory_admin_store import MemoryAdminStore

    if admin_store_configured(settings):
        return KeycloakAdminStore(
            base_url=settings.keycloak_admin_url or "",
            username=settings.keycloak_admin_username,
            password=settings.keycloak_admin_password or "",
            portal_client_id=settings.portal_client_id,
            portal_login_url=settings.portal_login_url,
        )
    if settings.auth_disabled:
        return MemoryAdminStore()
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Admin identity store is not configured",
    )
