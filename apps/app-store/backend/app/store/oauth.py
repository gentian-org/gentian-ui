"""Signing a person in to the store, and where the store token is kept.

The edge is the only session authority on a cluster, with one exception: this
app's sign-in to a store outside it. That exception is held to three
conditions, and this module is where the first is kept:

**The backend exchanges the code and keeps the token.** The authorization
request is built here, the redirect comes back to this API's own
`/oauth/callback`, the code is exchanged from here, and the store token stays
in this process. It is never put in an answer, a cookie, a log line or a
file. The browser carries the code through the redirect and nothing else, and
learns only that the person is signed in.

It is OAuth 2.0 authorization code with PKCE (S256). This app is a public
client: it has no client secret, because a secret shipped to every cluster is
not one.

Where "bound to the cluster session" is anchored
------------------------------------------------
The edge puts the zone's token on every request, and that is all this API
receives of the person's session. Its `sub` names the person and its `sid`
the session the identity provider holds; both survive the edge's refreshes
(`app.core.auth.session_key`). Everything here is keyed by that pair:

* a pending sign-in -- `state` and the PKCE verifier -- belongs to the session
  that started it, is used once, and is refused when the callback arrives on
  another session;
* a store token is found only by a request of the session that obtained it.

A store token is kept until it expires, as the issuer stated, or until the
person signs out of the store. Nothing tells this process that a cluster
session has ended; what makes the binding hold is that the token is
unreachable from any other session, since another sign-in to the cluster is
another `sid`.

One process, in memory
----------------------
All of it lives in this process and is gone when it restarts: the person
signs in to the store again. That is why the chart runs one replica of this
API. A second replica would need the pending sign-ins and the tokens to be
shared between them, or every request of one cluster session to reach the
same replica; neither is built, and no database is added for it.

Refresh tokens are not used. The definition lets an issuer hand one out and
does not ask a client to use it; one that arrives is dropped unread. When the
store answers 401 the token is forgotten and the person signs in again.
"""

import base64
import hashlib
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode, urlsplit

from app.core.config import Settings
from app.core.problems import Refusal
from app.store import client as store_client
from app.store import models
from app.store.client import USER_AGENT, Store, assert_public, fetch, not_the_format, origin_of

# What a client asks for at sign-in: both scopes, and no other.
SCOPES = "store.read store.acquire"
PENDING_TTL_SECONDS = 600
MAX_PENDING_PER_SESSION = 5
MAX_PENDING = 2000
# An issuer that states no lifetime: the token is kept this long, and a 401
# from the store ends it sooner.
DEFAULT_TOKEN_SECONDS = 3600
MAX_TOKEN_SECONDS = 24 * 3600
MAX_TOKEN_ANSWER_BYTES = 64 * 1024

# RFC 6749: a code is printable ASCII. Anything else is not one.
_CODE = re.compile(r"[\x21-\x7e]{1,4096}")
_STATE = re.compile(r"[A-Za-z0-9_-]{20,200}")
_TOKEN = re.compile(r"[\x21-\x7e]{1,8192}")

# A seam for the tests.
clock = time.monotonic


@dataclass
class Pending:
    session: str
    verifier: str = field(repr=False)
    token_endpoint: str
    issuer_origin: str
    client_id: str
    redirect_uri: str
    created: float


@dataclass
class StoreSession:
    """One person's sign-in to the store, for one cluster session."""

    token: str = field(repr=False)
    expires_at: float
    standing: models.TenantStanding | None = None


class SignInRefused(Exception):
    """Why a callback did not sign anybody in. `reason` is one of a fixed
    set, because it is shown: nothing a store or a query string said is."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


_pending: dict[str, Pending] = {}
_sessions: dict[str, StoreSession] = {}


def reset() -> None:
    """Forget every pending sign-in and every token. For the tests."""
    _pending.clear()
    _sessions.clear()


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _sweep() -> None:
    now = clock()
    for state in [s for s, p in _pending.items() if now - p.created > PENDING_TTL_SECONDS]:
        del _pending[state]
    for key in [k for k, s in _sessions.items() if s.expires_at <= now]:
        del _sessions[key]


def _endpoint(metadata: Any, key: str, issuer_origin: str) -> str:
    """One of the issuer's endpoints: https, and on the issuer's own origin."""
    value = metadata.get(key) if isinstance(metadata, dict) else None
    if not isinstance(value, str) or origin_of(value) != issuer_origin:
        raise not_the_format()
    if urlsplit(value).fragment:
        raise not_the_format()
    return value


async def begin(settings: Settings, store: Store, session: str) -> str:
    """Start a sign-in for one cluster session: the address to send the
    person's browser to. `state` and the verifier stay here."""
    redirect_uri, tenant_url = settings.redirect_uri, settings.tenant_url
    if not redirect_uri or not tenant_url:
        raise Refusal(
            status=503,
            source="app",
            code="host-not-configured",
            detail="This app has not been told its own host (APP_HOST, the chart value host), "
            "so it cannot name the address a store's sign-in returns to.",
        )
    meta = await store.meta()
    issuer = meta.issuer.rstrip("/")
    issuer_origin = origin_of(issuer)
    if issuer_origin is None:
        raise not_the_format()
    await assert_public(issuer)
    raw = await fetch(
        "GET",
        f"{issuer}/.well-known/oauth-authorization-server",
        allowed_origin=issuer_origin,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        max_bytes=MAX_TOKEN_ANSWER_BYTES,
    )
    if raw.status != 200:
        raise store_client.unreachable()
    metadata = raw.json()
    if not isinstance(metadata, dict):
        raise not_the_format()
    # RFC 8414 §3.3: the metadata is this issuer's only if it says so.
    if str(metadata.get("issuer", "")).rstrip("/") != issuer:
        raise not_the_format()
    methods = metadata.get("code_challenge_methods_supported")
    if methods is not None and "S256" not in methods:
        raise not_the_format()
    authorization_endpoint = _endpoint(metadata, "authorization_endpoint", issuer_origin)
    token_endpoint = _endpoint(metadata, "token_endpoint", issuer_origin)

    _sweep()
    mine = [s for s, p in _pending.items() if p.session == session]
    for state in mine[: max(0, len(mine) - MAX_PENDING_PER_SESSION + 1)]:
        del _pending[state]
    if len(_pending) >= MAX_PENDING:
        raise Refusal(status=503, source="app", code="busy")

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    _pending[state] = Pending(
        session=session,
        verifier=verifier,
        token_endpoint=token_endpoint,
        issuer_origin=issuer_origin,
        client_id=meta.clientId,
        redirect_uri=redirect_uri,
        created=clock(),
    )
    query = urlencode(
        {
            "response_type": "code",
            "client_id": meta.clientId,
            "redirect_uri": redirect_uri,
            "scope": SCOPES,
            "state": state,
            "code_challenge": _challenge(verifier),
            "code_challenge_method": "S256",
            "tenant_url": tenant_url,
        }
    )
    separator = "&" if urlsplit(authorization_endpoint).query else "?"
    return f"{authorization_endpoint}{separator}{query}"


async def complete(session: str, code: str | None, state: str | None) -> StoreSession:
    """Finish a sign-in: the callback's `code` and `state`, on the cluster
    session the request arrived with.

    The pending entry is taken out before anything is checked, so a `state`
    is good for one callback whatever becomes of it: a replay finds nothing,
    and so does a second try after a callback that arrived on another
    session.
    """
    _sweep()
    if not state or not _STATE.fullmatch(state):
        raise SignInRefused("state")
    pending = _pending.pop(state, None)
    if pending is None:
        raise SignInRefused("state")
    if not secrets.compare_digest(pending.session, session):
        raise SignInRefused("other-session")
    if not code or not _CODE.fullmatch(code):
        raise SignInRefused("code")
    try:
        raw = await fetch(
            "POST",
            pending.token_endpoint,
            allowed_origin=pending.issuer_origin,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            form={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": pending.redirect_uri,
                "client_id": pending.client_id,
                "code_verifier": pending.verifier,
            },
            max_bytes=MAX_TOKEN_ANSWER_BYTES,
        )
        answer = raw.json() if raw.status == 200 else None
    except Refusal as exc:
        raise SignInRefused("exchange") from exc
    if not isinstance(answer, dict):
        raise SignInRefused("exchange")
    token = answer.get("access_token")
    if (
        not isinstance(token, str)
        or not _TOKEN.fullmatch(token)
        or str(answer.get("token_type", "")).lower() != "bearer"
    ):
        raise SignInRefused("exchange")
    lifetime = answer.get("expires_in")
    if not isinstance(lifetime, int) or isinstance(lifetime, bool) or lifetime <= 0:
        lifetime = DEFAULT_TOKEN_SECONDS
    # Whatever else the issuer sent -- a refresh token among it -- goes no
    # further than this function.
    signed_in = StoreSession(token=token, expires_at=clock() + min(lifetime, MAX_TOKEN_SECONDS))
    _sessions[session] = signed_in
    return signed_in


def current(session: str) -> StoreSession | None:
    """The store sign-in of this cluster session, while its token lasts."""
    signed_in = _sessions.get(session)
    if signed_in is None:
        return None
    if signed_in.expires_at <= clock():
        del _sessions[session]
        return None
    return signed_in


def require(session: str) -> StoreSession:
    signed_in = current(session)
    if signed_in is None:
        raise Refusal(status=403, source="app", code="store-sign-in-required")
    return signed_in


def sign_out(session: str) -> None:
    """Drop the token and every sign-in this session had started."""
    _sessions.pop(session, None)
    for state in [s for s, p in _pending.items() if p.session == session]:
        del _pending[state]


def seconds_left(signed_in: StoreSession) -> int:
    return max(0, int(signed_in.expires_at - clock()))


async def standing(
    store: Store, session: str, language: str | None = None, *, refresh: bool = False
) -> models.TenantStanding:
    """The tenant's standing at the store: asked once after each sign-in,
    before the call the person wanted, and kept with the sign-in."""
    signed_in = require(session)
    if signed_in.standing is None or refresh:
        try:
            signed_in.standing = await store.tenant(signed_in.token, session, language)
        except Refusal as exc:
            forget_if_unauthenticated(session, exc)
            raise
    return signed_in.standing


def forget_if_unauthenticated(session: str, refusal: Refusal) -> None:
    """A 401 from the store means the token is no longer one: forget it, and
    the person signs in again."""
    if refusal.source == "store" and refusal.code == "store-sign-in-required":
        _sessions.pop(session, None)
