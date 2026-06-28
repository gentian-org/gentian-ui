"""Database session helpers with tenant isolation (M26).

When prefs or other shell data is persisted, scope queries by the authenticated
user's tenant from JWT — never accept tenant_id from the client.
"""

from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

from app.core.config import Settings, get_settings


class TenantScopedSession:
    """Stub session — replace with SQLModel session + tenant filter mixin."""

    def __init__(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id

    def query(self, model: type, **filters: Any) -> list[Any]:
        _ = model
        return [{"tenant_id": self.tenant_id, **filters}]


@contextmanager
def get_tenant_session(
    tenant_id: str,
    settings: Settings | None = None,
) -> Generator[TenantScopedSession, None, None]:
    _settings = settings or get_settings()
    session = TenantScopedSession(tenant_id=tenant_id)
    try:
        yield session
    finally:
        pass
