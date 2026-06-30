"""Admin Console identity store abstraction (Keycloak or in-memory dev)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings


INVITE_EMAIL_ATTR = "gentian.inviteEmail"
CONFIGURE_TOTP_ACTION = "CONFIGURE_TOTP"
UPDATE_PASSWORD_ACTION = "UPDATE_PASSWORD"


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


@dataclass
class UserSession:
    id: str
    member_id: str
    client_id: str
    client_name: str
    ip_address: str | None
    started_at: int
    last_access_at: int


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

    async def list_member_sessions(self, realm: str, member_id: str) -> list[UserSession]: ...

    async def revoke_member_session(self, realm: str, member_id: str, session_id: str) -> None: ...

    async def revoke_all_member_sessions(self, realm: str, member_id: str) -> None: ...

    async def send_password_reset_by_email(self, realm: str, email: str) -> bool: ...


def admin_store_configured(settings: Settings) -> bool:
    return bool(settings.keycloak_admin_url and settings.keycloak_admin_password)


_memory_admin_store: AdminStore | None = None


def get_admin_store(settings: Settings = Depends(get_settings)) -> AdminStore:
    global _memory_admin_store
    from app.services.keycloak_admin_store import KeycloakAdminStore
    from app.services.memory_admin_store import MemoryAdminStore

    if admin_store_configured(settings):
        return KeycloakAdminStore(
            base_url=settings.keycloak_admin_url or "",
            username=settings.keycloak_admin_username,
            password=settings.keycloak_admin_password or "",
            portal_client_id=settings.portal_client_id,
            portal_login_url=settings.portal_login_url,
            idp_public_host=settings.idp_public_host,
        )
    if settings.auth_disabled:
        if _memory_admin_store is None:
            _memory_admin_store = MemoryAdminStore()
        return _memory_admin_store
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Admin identity store is not configured",
    )


AdminStoreDep = Annotated[AdminStore, Depends(get_admin_store)]
