"""Refuse state-changing requests a page on another origin made the browser send.

Behind the edge the browser's session is a cookie the Gateway turns into the
bearer this API relays, so the browser attaches a person's authority to any
request for this host, whoever wrote the page that issued it. This middleware
asks where a POST, PUT, PATCH or DELETE came from and refuses one that did not
come from this API's own origin. GET, HEAD and OPTIONS are never refused.

The rule, in order:

1. ``Origin`` present: accept when it is in the configured allow-list, or
   when its host and port are the request's own ``Host`` and its scheme is
   https or -- outside edge mode only -- the scheme this server saw. Anything
   else is refused, including ``Origin: null``.
2. ``Origin`` absent, ``Sec-Fetch-Site`` present: accept ``same-origin`` only.
   ``none`` (a request no page initiated: the address bar, a bookmark) is
   refused too, because nothing a person does by hand issues these methods to
   this API.
3. Neither header: accept. Browsers send ``Origin`` on these methods, so this
   is a client that is not a browser -- a CLI, another service -- and it
   carries a real bearer rather than an ambient cookie.

About the request's own origin. The Gateway terminates TLS and passes ``Host``
through unchanged, so the host is the public one. The scheme is not: this
server sees http, and uvicorn takes ``X-Forwarded-Proto`` only from the
addresses in its ``--forwarded-allow-ips`` (loopback unless a deployment says
otherwise), which the Gateway is not. Rather than start trusting a forwarding
header here, an https ``Origin`` on the request's own host is accepted as the
same origin, and in edge mode -- where the session only exists over TLS -- it
is the only scheme accepted. ``X-Forwarded-Host`` is never read.

What this leaves open:

* A browser that sends neither ``Origin`` nor ``Sec-Fetch-Site`` on these
  methods (none current; some from before 2020), or something between the
  browser and the edge that strips both, is not protected by rule 3.
* A page on this same origin -- script injected into the bundle, or anything
  else served under this host -- is same-origin and passes. This is not a
  defence against cross-site scripting.
* A GET that changes state is not checked. Routes must not change state on
  GET.
* Outside edge mode an http ``Origin`` on the same host passes when this
  server itself was reached over http, which is the local development case.
"""

import json
from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

CHECKED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_DEFAULT_PORTS = {"http": ":80", "https": ":443"}


def _authority(netloc: str, scheme: str) -> str:
    """Host and port as a browser writes them in an origin: default port dropped."""
    netloc = netloc.strip().lower()
    default = _DEFAULT_PORTS.get(scheme, "")
    if default and netloc.endswith(default):
        netloc = netloc[: -len(default)]
    return netloc


def _parse_origin(value: str) -> tuple[str, str] | None:
    """(scheme, authority) of a serialised origin, or None when it is not one."""
    try:
        parts = urlsplit(value.strip())
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname:
        return None
    if parts.username or parts.password or parts.path not in ("", "/") or parts.query:
        return None
    return scheme, _authority(parts.netloc, scheme)


class OriginCheckMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        trusted_origins: Iterable[str] = (),
        https_only: bool = False,
    ) -> None:
        self.app = app
        self.https_only = https_only
        self.trusted = {p for p in map(_parse_origin, trusted_origins) if p is not None}

    def _refusal(self, scope: Scope) -> tuple[str, str] | None:
        """Why this request is refused as (reason, detail), or None to let it through."""
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        origin = headers.get("origin")
        if origin is not None:
            parsed = _parse_origin(origin)
            if parsed is not None:
                if parsed in self.trusted:
                    return None
                scheme, authority = parsed
                own_schemes = {"https"} if self.https_only else {"https", scope.get("scheme")}
                if scheme in own_schemes and authority == _authority(
                    headers.get("host", ""), scheme
                ):
                    return None
            return (
                "origin_mismatch",
                (
                    "Refused: this request was sent by a page on another origin "
                    f"({origin.strip()[:200]}), not by this application."
                ),
            )
        site = headers.get("sec-fetch-site")
        if site is not None:
            if site.strip().lower() == "same-origin":
                return None
            return (
                "cross_site_request",
                (
                    "Refused: the browser reports this request as "
                    f"'{site.strip()[:40]}', not as one this application made itself."
                ),
            )
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"].upper() not in CHECKED_METHODS:
            await self.app(scope, receive, send)
            return
        refusal = self._refusal(scope)
        if refusal is None:
            await self.app(scope, receive, send)
            return
        reason, detail = refusal
        body = json.dumps({"detail": detail, "reason": reason}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
