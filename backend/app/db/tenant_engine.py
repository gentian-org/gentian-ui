"""Per-tenant portal database engines and sessions."""

from __future__ import annotations

import threading
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.db.base import Base
from app.models.admin_audit_event import AdminAuditEventRow  # noqa: F401 — register model
from app.models.admin_notification import (  # noqa: F401 — register models
    AdminNotificationDismissalRow,
    AdminNotificationRow,
)
from app.models.user_shell_prefs import UserShellPrefsRow, ShellPrefsTemplateRow  # noqa: F401 — register models
from app.db.engine import init_portal_database, portal_database_ready
from app.services.portal_shell_secrets import resolve_tenant_database_url

_engines: dict[str, Engine] = {}
_session_factories: dict[str, sessionmaker[Session]] = {}
_lock = threading.Lock()
_initialized_tenants: set[str] = set()


def uses_shared_dev_database(settings: Settings | None = None) -> bool:
    _settings = settings or get_settings()
    return bool(_settings.database_url)


def ensure_tenant_database(tenant: str, settings: Settings | None = None) -> None:
    _settings = settings or get_settings()
    if uses_shared_dev_database(_settings):
        init_portal_database(_settings.database_url)
        return

    with _lock:
        if tenant in _initialized_tenants:
            return
        database_url = resolve_tenant_database_url(tenant, _settings)
        engine = _engines.get(tenant)
        if engine is None:
            from sqlalchemy import create_engine

            if database_url.startswith("sqlite"):
                from sqlalchemy.pool import StaticPool
                engine = create_engine(
                    database_url,
                    connect_args={"check_same_thread": False},
                    poolclass=StaticPool,
                )
            else:
                engine = create_engine(database_url, pool_pre_ping=True)
            _engines[tenant] = engine
            _session_factories[tenant] = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(engine)
        from app.db.engine import migrate_database_add_prefs_json
        migrate_database_add_prefs_json(engine)
        _initialized_tenants.add(tenant)


def tenant_database_ready(tenant: str, settings: Settings | None = None) -> bool:
    _settings = settings or get_settings()
    if uses_shared_dev_database(_settings):
        return portal_database_ready()
    with _lock:
        return tenant in _initialized_tenants


@contextmanager
def get_tenant_db_session(tenant: str, settings: Settings | None = None) -> Generator[Session, None, None]:
    _settings = settings or get_settings()
    ensure_tenant_database(tenant, _settings)
    if uses_shared_dev_database(_settings):
        from app.db.engine import get_db_session

        with get_db_session() as session:
            yield session
        return

    factory = _session_factories.get(tenant)
    if factory is None:
        raise RuntimeError(f"Tenant database is not initialized for {tenant}")
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_tenant_databases_for_tests() -> None:
    with _lock:
        _engines.clear()
        _session_factories.clear()
        _initialized_tenants.clear()
