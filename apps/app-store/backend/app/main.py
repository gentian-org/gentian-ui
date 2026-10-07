"""The App Store app's own API.

Two sides, held apart. Toward the store it is a client of the store API:
anonymous for browsing, and with the token of the person's store account for
what concerns the tenant. Toward the cluster it is a caller like any other:
it asks the director, the custodian and the usher with the token the
platform's edge forwards, and is subject to the checks every caller is. It
has no authority of its own in either direction, no credential, no database
and no Kubernetes access.

What it keeps is in this process's memory and nowhere else: answers of the
store's open reads for as long as the store said they may be kept, a person's
store token for as long as it lasts, and a repository credential between the
store's confirmation and the custodian's answer.

No CORS: the bundle and this API share one origin, and no other origin has
any business here.
"""

import logging

from fastapi import FastAPI

from app.api.routes import catalogue, health, install, media, session, store_session
from app.core.config import get_settings
from app.core.logging_middleware import RedactingAccessLogMiddleware
from app.core.origin_check import OriginCheckMiddleware
from app.core.problems import Refusal, refusal_handler
from app.core.security_headers import SecurityHeadersMiddleware

settings = get_settings()

# The HTTP client logs every address it asks, query included, at INFO. What
# this process asks a store -- what was searched for, which acquisition --
# is nobody's to read in a log.
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title=settings.project_name, openapi_url=f"{settings.api_v1_str}/openapi.json")
app.add_exception_handler(Refusal, refusal_handler)

# Added first, so it sits innermost: a refused request is still logged, and
# still answered with the headers every answer carries.
app.add_middleware(
    OriginCheckMiddleware,
    trusted_origins=settings.csrf_trusted_origin_list,
    https_only=settings.is_edge,
)
app.add_middleware(RedactingAccessLogMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health.router)
app.include_router(store_session.callback_router)
app.include_router(session.router, prefix=settings.api_v1_str)
app.include_router(catalogue.router, prefix=settings.api_v1_str)
app.include_router(media.router, prefix=settings.api_v1_str)
app.include_router(store_session.router, prefix=settings.api_v1_str)
app.include_router(install.router, prefix=settings.api_v1_str)
