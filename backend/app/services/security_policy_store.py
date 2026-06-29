"""Security policy store abstraction (Keycloak realm or in-memory dev)."""

from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException, status

from app.core.config import Settings
from app.services.admin_store import AdminStore
from app.services.security_policies import SecurityPolicies


class SecurityPolicyStore(Protocol):
    async def get_security_policies(self, realm: str) -> SecurityPolicies: ...

    async def update_security_policies(
        self,
        realm: str,
        tenant: str,
        policies: SecurityPolicies,
        admin_store: AdminStore,
    ) -> SecurityPolicies: ...


def get_security_policy_store(settings: Settings) -> SecurityPolicyStore:
    from app.services.keycloak_security_policy_store import KeycloakSecurityPolicyStore
    from app.services.memory_security_policy_store import MemorySecurityPolicyStore

    if settings.auth_disabled:
        return MemorySecurityPolicyStore()
    if settings.keycloak_admin_url and settings.keycloak_admin_password:
        return KeycloakSecurityPolicyStore(
            base_url=settings.keycloak_admin_url or "",
            username=settings.keycloak_admin_username,
            password=settings.keycloak_admin_password or "",
        )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Security policy store is not configured",
    )
