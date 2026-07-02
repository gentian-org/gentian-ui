"""In-memory admin store for local development (AUTH_DISABLED)."""

from __future__ import annotations

import uuid
from copy import deepcopy

from fastapi import HTTPException, status

from app.core.gentian_groups import tenant_app_admins_group, tenant_members_group, tenant_prefix
from app.services.admin_store import Group, Member, UserSession


class MemoryAdminStore:
    def __init__(self) -> None:
        self._members: dict[str, dict[str, Member]] = {}
        self._groups: dict[str, dict[str, Group]] = {}
        self._member_groups: dict[str, dict[str, set[str]]] = {}
        self._sessions: dict[str, dict[str, list[UserSession]]] = {}

    def _ensure_realm(self, realm: str) -> None:
        if realm not in self._members:
            self._members[realm] = {}
            self._groups[realm] = {}
            self._member_groups[realm] = {}
            self._sessions[realm] = {}
            members_name = tenant_members_group(realm)
            group_id = str(uuid.uuid4())
            self._groups[realm][group_id] = Group(
                id=group_id,
                name=members_name,
                path=f"/{members_name}",
            )
            app_admins_name = tenant_app_admins_group(realm)
            app_admins_id = str(uuid.uuid4())
            self._groups[realm][app_admins_id] = Group(
                id=app_admins_id,
                name=app_admins_name,
                path=f"/{app_admins_name}",
            )

    async def list_members(self, realm: str) -> list[Member]:
        self._ensure_realm(realm)
        return [self._hydrate_member(realm, member) for member in self._members[realm].values()]

    async def get_member(self, realm: str, member_id: str) -> Member:
        self._ensure_realm(realm)
        member = self._members[realm].get(member_id)
        if member is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        return self._hydrate_member(realm, member)

    async def create_member(
        self,
        realm: str,
        *,
        username: str,
        email: str,
        first_name: str | None,
        last_name: str | None,
        enabled: bool,
    ) -> Member:
        self._ensure_realm(realm)
        member_id = str(uuid.uuid4())
        member = Member(
            id=member_id,
            username=username,
            email=email,
            first_name=first_name,
            last_name=last_name,
            enabled=enabled,
        )
        self._members[realm][member_id] = member
        self._member_groups[realm][member_id] = set()
        return await self.get_member(realm, member_id)

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
    ) -> Member:
        member = await self.create_member(
            realm,
            username=username,
            email=email,
            first_name=first_name,
            last_name=last_name,
            enabled=True,
        )
        if invite_email:
            stored = self._members[realm][member.id]
            stored.invite_email = invite_email
        if require_totp:
            stored = self._members[realm][member.id]
            stored.totp_pending = True
        if group_ids:
            await self.set_member_groups(realm, member.id, group_ids)
        return await self.get_member(realm, member.id)

    async def send_password_reset(self, realm: str, member_id: str) -> str:
        member = await self.get_member(realm, member_id)
        return member.invite_email or member.email or member.username

    async def send_password_reset_by_email(self, realm: str, email: str) -> bool:
        self._ensure_realm(realm)
        normalized = email.strip().lower()
        for member in self._members[realm].values():
            if (member.email or "").lower() == normalized or (member.username or "").lower() == normalized:
                return True
        return False

    async def restore_workspace_email_for_login(self, realm: str, keycloak_username: str) -> None:
        return

    async def enable_totp(self, realm: str, member_id: str, *, send_email: bool) -> Member:
        member = await self.get_member(realm, member_id)
        if member.totp_configured:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="TOTP is already configured for this member",
            )
        stored = self._members[realm][member_id]
        stored.totp_pending = True
        return await self.get_member(realm, member_id)

    async def remove_totp(self, realm: str, member_id: str) -> Member:
        stored = self._members[realm][member_id]
        stored.totp_configured = False
        stored.totp_pending = False
        return await self.get_member(realm, member_id)

    async def clear_totp_requirement(self, realm: str, member_id: str) -> None:
        member = await self.get_member(realm, member_id)
        if member.totp_configured:
            return
        self._members[realm][member_id].totp_pending = False

    async def update_member(
        self,
        realm: str,
        member_id: str,
        *,
        email: str | None,
        first_name: str | None,
        last_name: str | None,
        enabled: bool | None,
        invite_email: str | None = None,
        invite_email_set: bool = False,
    ) -> Member:
        member = await self.get_member(realm, member_id)
        if email is not None:
            member.email = email
        if first_name is not None:
            member.first_name = first_name
        if last_name is not None:
            member.last_name = last_name
        if enabled is not None:
            member.enabled = enabled
        if invite_email_set:
            member.invite_email = invite_email.strip() if invite_email and invite_email.strip() else None
        self._members[realm][member_id] = member
        if enabled is False:
            self._sessions[realm][member_id] = []
        return await self.get_member(realm, member_id)

    async def delete_member(self, realm: str, member_id: str) -> None:
        self._ensure_realm(realm)
        if member_id not in self._members[realm]:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        del self._members[realm][member_id]
        self._member_groups[realm].pop(member_id, None)

    async def list_groups(self, realm: str) -> list[Group]:
        self._ensure_realm(realm)
        return list(self._groups[realm].values())

    async def create_group(self, realm: str, *, name: str) -> Group:
        self._ensure_realm(realm)
        group_id = str(uuid.uuid4())
        group = Group(id=group_id, name=name, path=f"/{name}")
        self._groups[realm][group_id] = group
        return deepcopy(group)

    async def get_group(self, realm: str, group_id: str) -> Group:
        self._ensure_realm(realm)
        group = self._groups[realm].get(group_id)
        if group is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        return deepcopy(group)

    async def update_group(self, realm: str, group_id: str, *, name: str) -> Group:
        group = await self.get_group(realm, group_id)
        group.name = name
        group.path = f"/{name}"
        self._groups[realm][group_id] = group
        return deepcopy(group)

    async def delete_group(self, realm: str, group_id: str) -> None:
        self._ensure_realm(realm)
        if group_id not in self._groups[realm]:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        del self._groups[realm][group_id]
        for memberships in self._member_groups[realm].values():
            memberships.discard(group_id)

    async def add_member_to_group(self, realm: str, member_id: str, group_id: str) -> None:
        await self.get_member(realm, member_id)
        await self.get_group(realm, group_id)
        self._member_groups[realm].setdefault(member_id, set()).add(group_id)

    async def remove_member_from_group(self, realm: str, member_id: str, group_id: str) -> None:
        await self.get_member(realm, member_id)
        self._member_groups[realm].get(member_id, set()).discard(group_id)

    async def set_member_groups(self, realm: str, member_id: str, group_ids: list[str]) -> Member:
        await self.get_member(realm, member_id)
        for group_id in group_ids:
            await self.get_group(realm, group_id)
        self._member_groups[realm][member_id] = set(group_ids)
        return await self.get_member(realm, member_id)

    async def list_member_sessions(self, realm: str, member_id: str) -> list[UserSession]:
        await self.get_member(realm, member_id)
        return [deepcopy(session) for session in self._sessions[realm].get(member_id, [])]

    async def revoke_member_session(self, realm: str, member_id: str, session_id: str) -> None:
        await self.get_member(realm, member_id)
        sessions = self._sessions[realm].get(member_id, [])
        self._sessions[realm][member_id] = [s for s in sessions if s.id != session_id]

    async def revoke_all_member_sessions(self, realm: str, member_id: str) -> None:
        await self.get_member(realm, member_id)
        self._sessions[realm][member_id] = []

    def seed_member_session(
        self,
        realm: str,
        member_id: str,
        *,
        client_name: str = "gentian-portal",
        ip_address: str = "10.0.0.1",
    ) -> UserSession:
        """Test helper — add a synthetic active session for a member."""
        self._ensure_realm(realm)
        session = UserSession(
            id=str(uuid.uuid4()),
            member_id=member_id,
            client_id=str(uuid.uuid4()),
            client_name=client_name,
            ip_address=ip_address,
            started_at=1_700_000_000,
            last_access_at=1_700_000_100,
        )
        self._sessions[realm].setdefault(member_id, []).append(session)
        return session

    def _hydrate_member(self, realm: str, member: Member) -> Member:
        group_ids = self._member_groups[realm].get(member.id, set())
        groups = [self._groups[realm][gid].name for gid in group_ids if gid in self._groups[realm]]
        hydrated = deepcopy(member)
        hydrated.groups = groups
        hydrated.invite_email = member.invite_email
        hydrated.totp_configured = member.totp_configured
        hydrated.totp_pending = member.totp_pending
        return hydrated

    @staticmethod
    def is_allowed_group_name(name: str, tenant: str) -> bool:
        return name.startswith(tenant_prefix(tenant))
