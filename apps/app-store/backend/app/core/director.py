# SPDX-License-Identifier: Apache-2.0
"""Relay to the cluster's services, as the caller.

Why a relay rather than calling them from the browser
-----------------------------------------------------
The director, the custodian and the usher serve no CORS headers and live on
the cluster network. Routing through this API keeps them there, gives the
bundle one origin, and means the browser never holds a second audience's
session.

What this deliberately does not do
----------------------------------
It holds no credential of its own and makes no authorisation decision. Every
call forwards the CALLER's bearer, which under edge is the zone's token the
Gateway put on the request, and the service asked decides from the
authorization graph what that person may see or change. Whatever it answers
comes back unchanged, including a refusal: a 403 from the director means the
caller does not hold the relation, and turning that into a friendlier status
here would be this component inventing an authorisation answer it is not
entitled to give.

Only a platform-trust component may relay: forwardToken on an exposure
requires trustTier platform, and without forwardToken there is no token here
to relay.

`forward`, `forward_to` and `read` are the administration console's own, and
answer what the service answered. `ask_*` below them are for this app's
sequences, which have to read an answer to know what to do next: the same
request, with the body parsed and a service that could not be reached turned
into a refusal that names it.
"""

import json
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, Response

from app.core.config import Settings
from app.core.problems import Refusal, cluster_text

_TIMEOUT = httpx.Timeout(15.0)


def base_url(settings: Settings) -> str:
    if not settings.director_url:
        raise HTTPException(
            status_code=503, detail="The director is not configured for this component."
        )
    return settings.director_url.rstrip("/")


async def forward(
    settings: Settings,
    method: str,
    path: str,
    token: str,
    *,
    params: dict[str, str] | None = None,
    json_body: object | None = None,
    timeout: httpx.Timeout | None = None,
) -> Response:
    """Pass one request to the director as the caller and hand back its answer verbatim."""
    url = f"{base_url(settings)}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout or _TIMEOUT) as client:
            upstream = await client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"The director is unreachable: {exc}") from exc
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


def custodian_url(settings: Settings) -> str:
    """Where credential writes go.

    A separate service from the director and a separate question: the
    director decides what a person may do and writes git, the credential
    manager exchanges the person's token for one OpenBao accepts and writes
    the secret. Neither holds authority of its own, and this component holds
    neither of theirs.
    """
    if not settings.custodian_url:
        raise HTTPException(
            status_code=503,
            detail="The custodian is not configured for this component.",
        )
    return settings.custodian_url.rstrip("/")


def usher_url(settings: Settings) -> str:
    """Where reads of live cluster state go.

    What the cluster holds of a tenant right now is the usher's to answer;
    the director answers 404 on it and keeps the writes. Unset is a 503 that
    names the setting, never a fall back to the director: an app quietly
    asking the wrong service would read as an empty cluster.
    """
    if not settings.usher_url:
        raise HTTPException(
            status_code=503,
            detail="The usher is not configured for this component: USHER_URL "
            "(the chart value usher.url) is not set.",
        )
    return settings.usher_url.rstrip("/")


async def read(
    settings: Settings, path: str, token: str, *, params: dict[str, str] | None = None
) -> Response:
    """One read of live state, asked of the usher as the caller.

    Its answer comes back unchanged, a refusal included. The usher writes its
    own errors as {"error": ...} and passes the operator's through as they
    came, which may be {"detail": ...}; neither is rewritten here.
    """
    return await forward_to(usher_url(settings), "GET", path, token, params=params)


async def forward_to(
    base: str,
    method: str,
    path: str,
    token: str,
    *,
    params: dict[str, str] | None = None,
    json_body: object | None = None,
) -> Response:
    """Pass one request to a service other than the director, as the caller.

    Same rule, same shape: the caller's own bearer, the answer unchanged,
    including a refusal. Only the base differs.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.request(
                method,
                f"{base}{path}",
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"The service is unreachable: {exc}") from exc
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


# ── for this app's sequences ────────────────────────────────────────────────


@dataclass
class Answer:
    """What a cluster service answered, read."""

    source: str
    status: int
    body: Any

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def text(self) -> str | None:
        """The service's own words, when its answer carried any."""
        return cluster_text(self.body)

    def refusal(self) -> Refusal:
        """This answer as a refusal: the service's status and its words."""
        return Refusal(
            status=self.status if self.status >= 400 else 502,
            source=self.source,
            code=f"http-{self.status}",
            detail=self.text,
            upstream_status=self.status,
        )


def _read(source: str, response: Response) -> Answer:
    try:
        body = json.loads(response.body) if response.body else None
    except (ValueError, UnicodeDecodeError):
        body = None
    return Answer(source=source, status=response.status_code, body=body)


def _unanswered(source: str, exc: HTTPException) -> Refusal:
    code = "not-configured" if exc.status_code == 503 else "unreachable"
    return Refusal(status=exc.status_code, source=source, code=code, detail=str(exc.detail))


async def ask_director(
    settings: Settings, method: str, path: str, token: str, *, json_body: object | None = None
) -> Answer:
    try:
        return _read("director", await forward(settings, method, path, token, json_body=json_body))
    except HTTPException as exc:
        raise _unanswered("director", exc) from exc


async def ask_custodian(
    settings: Settings, method: str, path: str, token: str, *, json_body: object | None = None
) -> Answer:
    try:
        base = custodian_url(settings)
        return _read("custodian", await forward_to(base, method, path, token, json_body=json_body))
    except HTTPException as exc:
        raise _unanswered("custodian", exc) from exc


async def ask_usher(settings: Settings, path: str, token: str) -> Answer:
    try:
        return _read("usher", await read(settings, path, token))
    except HTTPException as exc:
        raise _unanswered("usher", exc) from exc
