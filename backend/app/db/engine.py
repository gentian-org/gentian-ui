"""Database engine lifecycle for portal persistence."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.admin_audit_event import AdminAuditEventRow  # noqa: F401 — register model

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def init_audit_database(database_url: str) -> None:
    """Create engine and audit tables if they do not exist."""
    global _engine, _session_factory
    if _engine is not None:
        return
    _engine = create_engine(database_url, pool_pre_ping=True)
    Base.metadata.create_all(_engine)
    _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def audit_database_ready() -> bool:
    return _session_factory is not None


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
