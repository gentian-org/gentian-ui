"""What this API answers when something could not be done.

One shape for every refusal, whoever made it: the store, one of the cluster's
services, or this app. The screen shows `title` and `detail` as they are --
they are the refusing party's own words -- and branches on `code`.

A refusal by a cluster service keeps its status, a 401 included: under edge
that is the person's cluster session having ended, and the bundle reloads to
let the edge sign them in again. A 401 from the store is a different session
ending and is never answered as one: it becomes 403 with the code
`store-sign-in-required`, so the bundle asks for the store sign-in instead of
a reload.
"""

from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

_MAX_TEXT = 2000


def _clip(value: object, limit: int = _MAX_TEXT) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value[:limit]


@dataclass
class Refusal(Exception):
    """Something refused, in the refusing party's words."""

    status: int
    source: str  # store | director | custodian | usher | app
    code: str
    title: str | None = None
    detail: str | None = None
    reason: str | None = None
    retry_after: int | None = None
    upstream_status: int | None = None

    def __str__(self) -> str:
        return self.detail or self.title or self.code

    def body(self) -> dict:
        problem = {
            "source": self.source,
            "code": self.code,
            "status": self.upstream_status or self.status,
            "title": _clip(self.title, 300),
            "detail": _clip(self.detail),
            "reason": _clip(self.reason, 100),
            "retryAfter": self.retry_after,
        }
        return {
            "detail": _clip(self.detail) or _clip(self.title, 300) or self.code,
            "problem": {k: v for k, v in problem.items() if v is not None},
        }


async def refusal_handler(_request: Request, exc: Refusal) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after is not None:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(exc.body(), status_code=exc.status, headers=headers)


def cluster_text(body: object) -> str | None:
    """The words of a cluster service's refusal. The director, the custodian
    and the usher write {"error": ...}; what the usher relays from the
    operator may be {"detail": ...}."""
    if isinstance(body, dict):
        for key in ("error", "detail", "message"):
            text = _clip(body.get(key))
            if text:
                return text
    return None
