"""The assistant on the desktop: one conversation relayed to the model gateway.

The platform gives each tenant's desktop a key of its own at the gateway
(gentian-os: the desktop's profile declares requires.services.llm) and tells
this process where the gateway is and where the key is mounted. This module
relays a signed-in person's chat to the gateway with that key and streams the
answer back.

What that makes necessary, and what is done about it:

* The key is the TENANT's desktop's, not the person's. Whoever can open the
  desktop can use the assistant, and the gateway cannot tell them apart by
  key. The person's subject is passed as the OpenAI ``user`` field, which the
  gateway records as the end user of the request.
* The browser chooses nothing about the upstream call but the conversation.
  The two paths this module calls are spelled here -- chat completions and,
  to pick a model that exists, the model list -- and no part of either comes
  from the request. The body sent upstream is built from an allow-list of
  fields; the browser's headers are not forwarded.
* What one request may cost is capped here: the size of the body, the number
  of messages, and ``max_tokens``.
* The key is never logged and never part of an answer. An error from the
  gateway is reported by its status, not by relaying its body.

Where the platform says there is no gateway for this desktop, or told it
nothing, every route here answers 503 and the rest of the desktop is
unaffected.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings

logger = logging.getLogger("gentian.llm")

router = APIRouter(prefix="/llm", tags=["llm"])

# The only two things asked of the gateway, relative to its OpenAI base.
CHAT_COMPLETIONS_PATH = "/chat/completions"
MODELS_PATH = "/models"

UNAVAILABLE = "The assistant is not available on this desktop."

_ROLES = {"user", "assistant"}
_CONNECT_TIMEOUT = 5.0
_READ_TIMEOUT = 120.0


class _Gateway:
    """Where the gateway is and the key this desktop presents to it."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self._api_key = api_key

    def url(self, path: str) -> str:
        return self.base_url + path

    def headers(self) -> dict[str, str]:
        # Exactly these. Nothing the browser sent goes upstream.
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    def __repr__(self) -> str:  # the key must not reach a log through a repr
        return f"_Gateway(base_url={self.base_url!r})"


def _read_key(settings: Settings) -> str:
    if settings.llm_api_key_file:
        try:
            key = Path(settings.llm_api_key_file).read_text(encoding="utf-8").strip()
        except OSError:
            key = ""
        if key:
            return key
    if settings.llm_api_key is not None:
        return settings.llm_api_key.get_secret_value().strip()
    return ""


def _gateway(settings: Settings) -> _Gateway | None:
    """The gateway as the platform described it, or None when there is none."""
    if not settings.llm_available:
        return None
    base = (settings.llm_base_url or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        return None
    key = _read_key(settings)
    if not key:
        return None
    return _Gateway(base, key)


def _require_gateway(settings: Settings) -> _Gateway:
    gateway = _gateway(settings)
    if gateway is None:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    return gateway


async def _read_body(request: Request, limit: int) -> bytes:
    """The request body, refused once it is larger than the cap."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > limit:
                raise HTTPException(status_code=413, detail="The request is too large.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length") from None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail="The request is too large.")
        chunks.append(chunk)
    return b"".join(chunks)


def _upstream_body(raw: bytes, subject: str, settings: Settings) -> dict[str, Any]:
    """What is sent to the gateway: the conversation, and nothing else of the
    browser's. Every other field is this module's."""
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON")

    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages is required")
    if len(messages) > settings.llm_max_messages:
        raise HTTPException(status_code=413, detail="The conversation is too long.")
    clean: list[dict[str, str]] = []
    for message in messages:
        if (
            not isinstance(message, dict)
            or message.get("role") not in _ROLES
            or not isinstance(message.get("content"), str)
        ):
            raise HTTPException(
                status_code=400,
                detail="each message needs a role (user or assistant) and text content",
            )
        clean.append({"role": message["role"], "content": message["content"]})

    cap = settings.llm_max_tokens
    asked = body.get("max_tokens")
    max_tokens = cap
    if isinstance(asked, int) and not isinstance(asked, bool) and 0 < asked < cap:
        max_tokens = asked

    upstream: dict[str, Any] = {
        "messages": clean,
        "stream": body.get("stream") is not False,
        "max_tokens": max_tokens,
        # One answer per request, whatever was asked for.
        "n": 1,
    }
    model = body.get("model")
    if isinstance(model, str) and model.strip():
        upstream["model"] = model.strip()
    # Whose request this is. The key is the tenant's desktop's; the subject is
    # what tells one member's use from another's at the gateway.
    if subject:
        upstream["user"] = subject
    return upstream


async def _choose_model(client: httpx.AsyncClient, gateway: _Gateway, wanted: str | None) -> str:
    """A model the gateway serves to this key: the one asked for when it is
    one of them, the first otherwise."""
    try:
        resp = await client.get(gateway.url(MODELS_PATH), headers=gateway.headers())
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from None
    if resp.status_code in (401, 403):
        # The gateway does not know this desktop's key.
        logger.warning("the model gateway refused this desktop's key (status %s)", resp.status_code)
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    if resp.status_code != 200:
        logger.warning("the model gateway's model list answered %s", resp.status_code)
        raise HTTPException(status_code=502, detail="The model gateway did not answer.")
    try:
        data = resp.json().get("data", [])
        available = [m["id"] for m in data if isinstance(m, dict) and isinstance(m.get("id"), str)]
    except (ValueError, AttributeError):
        available = []
    if not available:
        raise HTTPException(status_code=503, detail="No model is available to this desktop.")
    return wanted if wanted in available else available[0]


@router.get("/status")
async def assistant_status(
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    """Whether this desktop has an assistant. No address and no key."""
    return {"available": _gateway(get_settings()) is not None}


@router.post("/chat")
async def chat(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    """Relay one chat completion. Every member who can open the desktop may."""
    settings = get_settings()
    gateway = _require_gateway(settings)
    raw = await _read_body(request, settings.llm_max_request_bytes)
    body = _upstream_body(raw, str(user.get("sub") or ""), settings)

    client = httpx.AsyncClient(timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT))
    try:
        body["model"] = await _choose_model(client, gateway, body.get("model"))
        upstream = await client.send(
            client.build_request(
                "POST",
                gateway.url(CHAT_COMPLETIONS_PATH),
                json=body,
                headers=gateway.headers(),
            ),
            stream=True,
        )
    except HTTPException:
        await client.aclose()
        raise
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from None

    if upstream.status_code != 200:
        status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        # By status only: the gateway's own error text is not this person's
        # to read, and may name what it was asked with.
        logger.warning("the model gateway answered %s to a chat completion", status)
        if status in (401, 403):
            raise HTTPException(status_code=503, detail=UNAVAILABLE)
        if status == 429:
            raise HTTPException(
                status_code=429, detail="The assistant is busy or over its limit. Try again later."
            )
        raise HTTPException(status_code=502, detail="The model gateway did not answer.")

    async def relay():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    media_type = "text/event-stream" if body["stream"] else "application/json"
    return StreamingResponse(
        relay(),
        media_type=media_type,
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
