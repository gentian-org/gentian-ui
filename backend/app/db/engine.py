"""Database engine lifecycle for portal persistence."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.admin_audit_event import AdminAuditEventRow  # noqa: F401 — register model
from app.models.admin_notification import (  # noqa: F401 — register models
    AdminNotificationDismissalRow,
    AdminNotificationRow,
)
from app.models.user_shell_prefs import UserShellPrefsRow  # noqa: F401 — register model

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def migrate_database_add_prefs_json(engine) -> None:
    from sqlalchemy import text
    try:
        with engine.begin() as conn:
            if "postgresql" in str(engine.url):
                conn.execute(text("ALTER TABLE user_shell_prefs ADD COLUMN IF NOT EXISTS prefs_json JSONB"))
            else:
                conn.execute(text("ALTER TABLE user_shell_prefs ADD COLUMN prefs_json JSON"))
    except Exception:
        pass


def init_portal_database(database_url: str) -> None:
    """Create engine and portal persistence tables if they do not exist."""
    global _engine, _session_factory
    if _engine is not None:
        return
    if database_url.startswith("sqlite"):
        from sqlalchemy.pool import StaticPool
        _engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    else:
        _engine = create_engine(database_url, pool_pre_ping=True)
    Base.metadata.create_all(_engine)
    migrate_database_add_prefs_json(_engine)
    _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def init_audit_database(database_url: str) -> None:
    """Backward-compatible alias for audit table initialization."""
    init_portal_database(database_url)


def portal_database_ready() -> bool:
    return _session_factory is not None


def audit_database_ready() -> bool:
    return portal_database_ready()


@contextmanager
def get_db_session() -> Generator[Session, None, None]:
    if _session_factory is None:
        raise RuntimeError("Audit database is not initialized")
    session = _session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def truncate_audit_events() -> None:
    if _session_factory is None:
        return
    with get_db_session() as session:
        session.execute(delete(AdminAuditEventRow))
        session.execute(delete(AdminNotificationDismissalRow))
        session.execute(delete(AdminNotificationRow))
