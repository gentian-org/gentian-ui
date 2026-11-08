"""The administration console's own API: a relay to the director, and nothing else.

This process holds no credential and keeps no state. It verifies the token the
platform's edge forwards, relays it to the director when a screen needs an
answer, and hands the answer back unchanged. Whatever a person may see or
change here is decided by the director from the authorization graph.
"""

from fastapi import Depends, FastAPI
from gentian_app_runtime.extensions import loader
from gentian_app_runtime.extensions.routes import extensions_router
from gentian_app_runtime.origin_check import OriginCheckMiddleware

from app.api.routes import (
    admin,
    approvals,
    apps,
    audit,
    backups,
    catalogue,
    cluster,
    credentials,
    health,
    notifications,
    people,
    perimeter,
    platform,
    resources,
    security,
    session,
    tenant_settings,
)
from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.logging_middleware import RedactingAccessLogMiddleware

settings = get_settings()

app = FastAPI(title=settings.project_name, openapi_url=f"{settings.api_v1_str}/openapi.json")

extension_registry = loader.discover(settings.app_id)

# Added first, so it sits innermost: a refused request is still logged, and
# the desktop's CORS answers are still written around it.
app.add_middleware(
    OriginCheckMiddleware,
    trusted_origins=settings.csrf_trusted_origin_list,
    https_only=settings.is_edge,
)
app.add_middleware(RedactingAccessLogMiddleware)

app.include_router(health.router)
app.include_router(session.router, prefix=settings.api_v1_str)
app.include_router(cluster.router, prefix=settings.api_v1_str)
# Each screen's own routes go before admin's, whose catch-all answers for
# the screens that are not yet clients of the director.
app.include_router(resources.router, prefix=settings.api_v1_str)
app.include_router(audit.router, prefix=settings.api_v1_str)
app.include_router(backups.router, prefix=settings.api_v1_str)
app.include_router(security.router, prefix=settings.api_v1_str)
app.include_router(tenant_settings.router, prefix=settings.api_v1_str)
app.include_router(platform.router, prefix=settings.api_v1_str)
app.include_router(catalogue.router, prefix=settings.api_v1_str)
app.include_router(apps.router, prefix=settings.api_v1_str)
app.include_router(perimeter.router, prefix=settings.api_v1_str)
app.include_router(people.router, prefix=settings.api_v1_str)
app.include_router(notifications.router, prefix=settings.api_v1_str)
# Before admin.router: its catch-all would answer /admin/approvals first.
app.include_router(approvals.router, prefix=settings.api_v1_str)
app.include_router(admin.router, prefix=settings.api_v1_str)
app.include_router(credentials.router, prefix=settings.api_v1_str)

# What is loaded and where it comes from, and what plugins add, is for a
# signed-in person as everything else here is.
_signed_in = [Depends(get_current_user)]
app.include_router(
    extensions_router(lambda: extension_registry, dependencies=_signed_in),
    prefix=settings.api_v1_str,
)
loader.mount_routes(extension_registry, app, settings.api_v1_str, dependencies=_signed_in)
