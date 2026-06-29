import os

os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("KERNEL_DOMAIN", "demo.desk.gentian.org")

from app.core.config import get_settings

get_settings.cache_clear()
