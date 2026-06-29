"""Keycloak realm security policy read/write."""

from __future__ import annotations

from urllib.parse import quote

from app.services.admin_store import AdminStore
from app.services.keycloak_admin_store import KeycloakAdminStore
from app.services.memory_security_policy_store import _sync_totp_policies
from app.services.security_policies import SecurityPolicies, policies_from_realm, policies_to_realm_update


class KeycloakSecurityPolicyStore(KeycloakAdminStore):
    async def get_security_policies(self, realm: str) -> SecurityPolicies:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}")
        return policies_from_realm(raw)

    async def update_security_policies(
        self,
        realm: str,
        tenant: str,
        policies: SecurityPolicies,
        admin_store: AdminStore,
    ) -> SecurityPolicies:
        raw = await self._request("GET", f"/admin/realms/{quote(realm, safe='')}")
        previous = policies_from_realm(raw)
        body = policies_to_realm_update(raw, policies)
        await self._request("PUT", f"/admin/realms/{quote(realm, safe='')}", json=body)
        await _sync_totp_policies(realm, tenant, previous, policies, admin_store)
        return await self.get_security_policies(realm)
