"""Headers on everything this API answers.

The pages are the web container's, and their content security policy is set
there (frontend/docker-entrypoint.sh). What this API answers is data, a
picture, or one redirect, and none of it is a page: so nothing may be loaded
by it, it is not to be framed, it is not to be kept by anything between here
and the browser, and no address it is reached from is handed on as a
referrer.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_DEFAULTS = (
    (b"cache-control", b"no-store"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-content-type-options", b"nosniff"),
)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                # A route that set one of these meant it: a picture says how
                # long the person's browser may keep it.
                headers += [(name, value) for name, value in _DEFAULTS if name not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
