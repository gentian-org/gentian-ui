import os

os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("KERNEL_DOMAIN", "demo.desk.gentian.org")

import pytest

from app.core.config import get_settings

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def reset_memory_admin_store():
    from app.services import admin_store

    admin_store._memory_admin_store = None
    yield
    admin_store._memory_admin_store = None
