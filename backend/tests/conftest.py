import os

os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("KERNEL_DOMAIN", "demo.desk.gentian.org")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest

from app.core.config import get_settings

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def reset_stores():
    """The databases, and nothing else.

    It also used to reset an in-memory admin store and a Keycloak audit
    fetcher. Both belonged to the bundled administration console, which held a
    Keycloak administrator credential; they are gone (gentian-os S7A.6) and so
    is the state that needed resetting between tests.
    """
    from app.db import engine as db_engine
    from app.db.tenant_engine import reset_tenant_databases_for_tests

    reset_tenant_databases_for_tests()
    db_engine._engine = None
    db_engine._session_factory = None
    settings = get_settings()
    if settings.database_url:
        db_engine.init_portal_database(settings.database_url)
    yield
    reset_tenant_databases_for_tests()
    db_engine._engine = None
    db_engine._session_factory = None
