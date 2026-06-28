"""Request logging with secret redaction (M7)."""

import logging
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("gentian.access")


class RedactingAccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        auth_header = request.headers.get("authorization", "")
        safe_auth = "[REDACTED]" if auth_header else "-"
        logger.info(
            "%s %s auth=%s",
            request.method,
            request.url.path,
            safe_auth,
        )
        return await call_next(request)
