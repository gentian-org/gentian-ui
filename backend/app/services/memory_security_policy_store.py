"""In-memory security policy store for local development (AUTH_DISABLED)."""

from __future__ import annotations

from copy import deepcopy

from app.core.gentian_groups import tenant_admins_group, tenant_members_group
from app.services.admin_store import AdminStore
from app.services.security_policies import SecurityPolicies


class MemorySecurityPolicyStore:
    def __init__(self) -> None:
        self._policies: dict[str, SecurityPolicies] = {}

    def _defaults(self, realm: str) -> SecurityPolicies:
        if realm not in self._policies:
            self._policies[realm] = SecurityPolicies()
        return self._policies[realm]

    async def get_security_policies(self, realm: str) -> SecurityPolicies:
        return deepcopy(self._defaults(realm))

    async def update_security_policies(
        self,
        realm: str,
        tenant: str,
        policies: SecurityPolicies,
        admin_store: AdminStore,
    ) -> SecurityPolicies:
        previous = deepcopy(self._defaults(realm))
        self._policies[realm] = deepcopy(policies)
        await _sync_totp_policies(realm, tenant, previous, policies, admin_store)
        return deepcopy(policies)


async def _sync_totp_policies(
    realm: str,
    tenant: str,
    previous: SecurityPolicies,
    current: SecurityPolicies,
    admin_store: AdminStore,
) -> None:
    admins_group = tenant_admins_group(tenant)
    members_group = tenant_members_group(tenant)

    if current.require_totp_admins and not previous.require_totp_admins:
        await _require_totp_for_group(realm, admins_group, admin_store)
    elif not current.require_totp_admins and previous.require_totp_admins:
        await _clear_totp_requirement_for_group(realm, admins_group, admin_store)

    prev_members_required = previous.require_totp_members == "required"
    curr_members_required = current.require_totp_members == "required"
    if curr_members_required and not prev_members_required:
        await _require_totp_for_group(realm, members_group, admin_store)
    elif not curr_members_required and prev_members_required:
        await _clear_totp_requirement_for_group(realm, members_group, admin_store)


async def _require_totp_for_group(realm: str, group_name: str, admin_store: AdminStore) -> None:
    for member in await admin_store.list_members(realm):
        if group_name not in member.groups:
            continue
        if member.totp_configured or member.totp_pending:
            continue
        await admin_store.enable_totp(realm, member.id, send_email=False)


async def _clear_totp_requirement_for_group(
    realm: str,
    group_name: str,
    admin_store: AdminStore,
) -> None:
    for member in await admin_store.list_members(realm):
        if group_name not in member.groups:
            continue
        if member.totp_pending and not member.totp_configured:
            await admin_store.clear_totp_requirement(realm, member.id)
