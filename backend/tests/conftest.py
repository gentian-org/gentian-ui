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
    from app.db import engine as db_engine
    from app.services import admin_store
    from app.services import audit_store as audit_store_module
    from app.services import notification_store as notification_store_module

    admin_store._memory_admin_store = None
    audit_store_module._memory_audit_store = None
    audit_store_module._keycloak_audit_fetcher = None
    notification_store_module._memory_notification_store = None
    db_engine._engine = None
    db_engine._session_factory = None
    settings = get_settings()
    if settings.database_url:
        init_audit_database = db_engine.init_audit_database
        init_audit_database(settings.database_url)
    yield
    admin_store._memory_admin_store = None
    audit_store_module._memory_audit_store = None
    audit_store_module._keycloak_audit_fetcher = None
    notification_store_module._memory_notification_store = None
    db_engine._engine = None
    db_engine._session_factory = None
