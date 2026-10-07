"""The one way out to a store.

A store is a service outside the cluster, on infrastructure the cluster does
not trust. Everything this app asks of one leaves through this module, and
the rules of the store API's definition are kept here rather than at each
call:

* **Where a request may go.** To the origin of the configured base address,
  and nowhere a store's answer points -- except the two kinds of address the
  definition lets a store name: its issuer and its media origins, both from
  `GET /v1/meta`, both https, both refused when they are not a public host
  (`assert_public`). A redirect is never followed: an answer that is one is
  not the format.
* **What an anonymous request carries.** The path and query, the language
  asked for, and a `User-Agent` naming this app and its version. No cookie
  (a client lives for one request, so nothing a store sets is ever sent
  back), no `Referer`, no `Origin`, no tenant, no cluster. The open reads are
  always made this way, signed in or not: a token is sent on the signed-in
  calls only.
* **Caching.** An open read is the same for everybody who asks in the same
  language, so its answer is kept in this process for the `max-age` the store
  states and revalidated with `If-None-Match` afterwards. A signed-in answer
  is never kept.
* **Rate limits.** `Retry-After` on a 429 or 503, and `RateLimit-Remaining: 0`
  with `RateLimit-Reset`, close a gate until the time the store named. While
  it is closed nothing is sent; an open read that is in the cache is answered
  from it, and everything else says how long to wait.
* **Bounds.** A timeout on every request and a size limit on every answer.
* **Errors.** `application/problem+json` becomes a `Refusal` with the store's
  own `title` and `detail`. An answer that is not the format -- not JSON, not
  the shape, a redirect, too large -- is treated as the store being
  unreachable.

Nothing here logs a header, a body or a token.
"""

import asyncio
import dataclasses
import ipaddress
import json
import math
import socket
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit

import httpx

from app.core.config import APP_VERSION, Settings
from app.core.problems import Refusal
from app.store import models, patterns

USER_AGENT = f"gentian-app-store/{APP_VERSION}"
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_CACHE_ENTRIES = 256
# A store chooses how long an open read may be kept; this app keeps none
# longer than an hour, and stays shut no longer than an hour on a store's word.
MAX_AGE_CAP_SECONDS = 3600
MAX_BLOCK_SECONDS = 3600
ANONYMOUS = "anonymous"

# Seams for the tests: the transport every request is sent through, and the
# clock the cache and the gates read.
TRANSPORT: httpx.AsyncBaseTransport | None = None
clock = time.monotonic

_NOT_PUBLIC_SUFFIXES = (".svc", ".cluster.local", ".local", ".internal", ".localhost", ".lan")


def origin_of(url: str) -> str | None:
    """`https://host[:port]` of an https URL, lower case, the default port
    dropped; None for anything else, including one with credentials in it."""
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or not host or parts.username or parts.password:
        return None
    if ":" in host:
        host = f"[{host}]"
    return f"https://{host.lower()}" + (f":{port}" if port and port != 443 else "")


def as_origin(value: str) -> str | None:
    """An origin a store listed (`mediaOrigins`, `checkoutOrigins`), or None
    when the entry is not exactly one: https, a host, no path."""
    origin = origin_of(value)
    if origin is None:
        return None
    parts = urlsplit(value)
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        return None
    return origin


def unreachable(detail: str | None = None) -> Refusal:
    return Refusal(status=502, source="store", code="store-unreachable", detail=detail)


def not_the_format() -> Refusal:
    """An answer that is not what the definition says. Treated as the store
    being unreachable, and never acted on in part."""
    return Refusal(status=502, source="store", code="store-format")


async def resolve(host: str) -> list[str]:
    """The addresses a host name stands for. A seam: the tests replace it."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def assert_public(url: str) -> None:
    """Refuse an address a store named that is not a public host.

    The issuer and the media origins come from a store's own answer, and this
    process then makes a request to them from inside the cluster. A store
    that named a cluster service or a private address would be pointing this
    app at something only the cluster can reach. So: a DNS name with a dot in
    it, not one of the cluster's own suffixes, and every address it resolves
    to a global one. It does not close the window between this lookup and the
    connection's own; the tenant namespace's egress policy is what stands
    behind it.
    """
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    if not host:
        raise not_the_format()
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise not_the_format()
        return
    if "." not in host or host.endswith(_NOT_PUBLIC_SUFFIXES):
        raise not_the_format()
    try:
        addresses = await resolve(host)
    except OSError as exc:
        raise unreachable() from exc
    if not addresses:
        raise unreachable()
    for address in addresses:
        try:
            if not ipaddress.ip_address(address.split("%", 1)[0]).is_global:
                raise not_the_format()
        except ValueError as exc:
            raise not_the_format() from exc


@dataclass
class Raw:
    status: int
    headers: httpx.Headers
    content: bytes

    def json(self) -> Any:
        try:
            return json.loads(self.content)
        except (ValueError, UnicodeDecodeError) as exc:
            raise not_the_format() from exc


async def fetch(
    method: str,
    url: str,
    *,
    allowed_origin: str,
    headers: dict[str, str],
    json_body: object | None = None,
    form: dict[str, str] | None = None,
    max_bytes: int | None = None,
) -> Raw:
    """One request to one origin: no redirect followed, no cookie kept, a
    timeout, and no more of the answer read than `max_bytes`."""
    if origin_of(url) != allowed_origin:
        raise not_the_format()
    limit = MAX_JSON_BYTES if max_bytes is None else max_bytes
    try:
        async with (
            httpx.AsyncClient(
                timeout=TIMEOUT, follow_redirects=False, transport=TRANSPORT
            ) as client,
            client.stream(method, url, headers=headers, json=json_body, data=form) as response,
        ):
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > limit:
                    raise not_the_format()
                chunks.append(chunk)
            return Raw(response.status_code, response.headers, b"".join(chunks))
    except httpx.HTTPError as exc:
        # The exception's own text can name a proxy or an address; the kind
        # of failure is all a screen needs.
        raise unreachable(type(exc).__name__) from exc


def _seconds(value: str | None) -> int | None:
    if value is None or not value.strip().isdigit():
        return None
    return int(value.strip())


def _max_age(headers: httpx.Headers) -> int | None:
    """How long an answer may be kept, or None when it may not be."""
    directives = [d.strip().lower() for d in headers.get("cache-control", "").split(",")]
    if "no-store" in directives or "private" in directives or "public" not in directives:
        return None
    for directive in directives:
        if directive.startswith("max-age="):
            seconds = _seconds(directive[len("max-age=") :])
            if seconds is not None:
                return min(seconds, MAX_AGE_CAP_SECONDS)
    return None


def _text(body: Any, key: str, limit: int) -> str | None:
    value = body.get(key) if isinstance(body, dict) else None
    return value[:limit] if isinstance(value, str) and value else None


@dataclass
class _Cached:
    body: Any
    etag: str | None
    fresh_until: float


class Store:
    def __init__(self, base: str) -> None:
        self.base = base
        origin = origin_of(base)
        if origin is None:
            raise Refusal(
                status=503,
                source="app",
                code="store-not-configured",
                detail="The store's address must be an https address.",
            )
        self.origin = origin
        self._cache: OrderedDict[tuple, _Cached] = OrderedDict()
        self._blocked: dict[str, tuple[float, Refusal]] = {}

    # ── the wire ────────────────────────────────────────────────────────────

    def _url(self, path: str, params: dict[str, str] | None) -> str:
        query = urlencode(sorted((params or {}).items()))
        return f"{self.base}{path}" + (f"?{query}" if query else "")

    def _gate(self, who: str) -> Refusal | None:
        """What `who` is answered while the store has asked for patience: the
        store's own refusal again, with the wait that is left. None when the
        store may be asked now."""
        held = self._blocked.get(who)
        if held is None:
            return None
        until, refusal = held
        remaining = until - clock()
        if remaining <= 0:
            del self._blocked[who]
            return None
        return dataclasses.replace(refusal, retry_after=math.ceil(remaining))

    def _note_limits(self, who: str, raw: Raw) -> None:
        wait = None
        retry_after = _seconds(raw.headers.get("retry-after"))
        if raw.status in (429, 503) and retry_after:
            wait, refusal = retry_after, self._refusal(raw)
        elif _seconds(raw.headers.get("ratelimit-remaining")) == 0:
            wait = _seconds(raw.headers.get("ratelimit-reset"))
            refusal = Refusal(status=429, source="store", code="rate-limited")
        if wait:
            now = clock()
            for key in [k for k, (until, _) in self._blocked.items() if until <= now]:
                del self._blocked[key]
            self._blocked[who] = (now + min(wait, MAX_BLOCK_SECONDS), refusal)

    def _refusal(self, raw: Raw) -> Refusal:
        """A status that is not a success, as the store put it."""
        body = None
        if "json" in raw.headers.get("content-type", ""):
            try:
                body = json.loads(raw.content)
            except (ValueError, UnicodeDecodeError):
                body = None
        title, detail = _text(body, "title", 300), _text(body, "detail", 2000)
        code = _text(body, "code", 60)
        retry_after = _seconds(raw.headers.get("retry-after"))
        if raw.status < 400:
            # A redirect, or a success of a kind the operation does not have.
            return not_the_format()
        if raw.status == 401:
            return Refusal(
                status=403,
                source="store",
                code="store-sign-in-required",
                title=title,
                detail=detail,
                upstream_status=401,
            )
        if raw.status == 429:
            return Refusal(
                status=429,
                source="store",
                code="rate-limited",
                title=title,
                detail=detail,
                retry_after=retry_after,
                upstream_status=429,
            )
        if raw.status >= 500:
            return Refusal(
                status=502,
                source="store",
                code="store-unavailable",
                title=title,
                detail=detail,
                retry_after=retry_after,
                upstream_status=raw.status,
            )
        return Refusal(
            status=raw.status,
            source="store",
            code=code or f"http-{raw.status}",
            title=title,
            detail=detail,
            reason=_text(body, "reason", 60),
            upstream_status=raw.status,
        )

    async def open_read(
        self, path: str, params: dict[str, str] | None = None, language: str | None = None
    ) -> Any:
        """An open read, made anonymously and answered from the cache when the
        store said it may be."""
        key = (path, tuple(sorted((params or {}).items())), language or "")
        cached = self._cache.get(key)
        if cached is not None and cached.fresh_until > clock():
            self._cache.move_to_end(key)
            return cached.body
        shut = self._gate(ANONYMOUS)
        if shut is not None:
            if cached is not None:
                return cached.body
            raise shut
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if language:
            headers["Accept-Language"] = language
        if cached is not None and cached.etag:
            headers["If-None-Match"] = cached.etag
        raw = await fetch(
            "GET", self._url(path, params), allowed_origin=self.origin, headers=headers
        )
        self._note_limits(ANONYMOUS, raw)
        if raw.status == 304 and cached is not None:
            cached.fresh_until = clock() + (_max_age(raw.headers) or 0)
            self._cache.move_to_end(key)
            return cached.body
        if raw.status != 200:
            raise self._refusal(raw)
        body = raw.json()
        max_age = _max_age(raw.headers)
        if max_age is not None:
            self._cache[key] = _Cached(body, raw.headers.get("etag"), clock() + max_age)
            self._cache.move_to_end(key)
            while len(self._cache) > MAX_CACHE_ENTRIES:
                self._cache.popitem(last=False)
        else:
            self._cache.pop(key, None)
        return body

    async def signed(
        self,
        method: str,
        path: str,
        token: str,
        *,
        session: str,
        params: dict[str, str] | None = None,
        json_body: object | None = None,
        idempotency_key: str | None = None,
        language: str | None = None,
    ) -> tuple[int, Any, int | None]:
        """A signed-in call: (status, body, the Retry-After it carried). Never
        cached, and counted against its own gate."""
        shut = self._gate(session)
        if shut is not None:
            raise shut
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        }
        if language:
            headers["Accept-Language"] = language
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        raw = await fetch(
            method,
            self._url(path, params),
            allowed_origin=self.origin,
            headers=headers,
            json_body=json_body,
        )
        self._note_limits(session, raw)
        if raw.status not in (200, 201, 202):
            raise self._refusal(raw)
        return raw.status, raw.json(), _seconds(raw.headers.get("retry-after"))

    # ── the open reads ──────────────────────────────────────────────────────

    async def meta(self) -> models.Meta:
        try:
            return models.Meta.model_validate(await self.open_read("/v1/meta"))
        except ValueError as exc:
            raise not_the_format() from exc

    async def categories(self, language: str | None) -> list[models.Category]:
        body = await self.open_read("/v1/categories", None, language)
        try:
            return models.parse_items(models.Category, _member(body, "items"))[0]
        except ValueError as exc:
            raise not_the_format() from exc

    async def apps(
        self, params: dict[str, str], language: str | None
    ) -> tuple[list[models.AppSummary], str | None, int]:
        body = await self.open_read("/v1/apps", params, language)
        try:
            items, omitted = models.parse_items(models.AppSummary, _member(body, "items"))
            return items, _cursor(body), omitted
        except ValueError as exc:
            raise not_the_format() from exc

    async def app(self, catalogue: str, app: str, language: str | None) -> models.AppDetail:
        path = f"/v1/apps/{patterns.name(catalogue, 'catalogue')}/{patterns.name(app, 'app')}"
        body = await self.open_read(path, None, language)
        try:
            detail = models.AppDetail.model_validate(body)
        except ValueError as exc:
            raise not_the_format() from exc
        if detail.coordinate != f"{catalogue}/{app}":
            # The entry asked for, or nothing: an answer about another entry
            # is not an answer to this request.
            raise not_the_format()
        return detail

    async def reviews(
        self, catalogue: str, app: str, params: dict[str, str], language: str | None
    ) -> tuple[models.ReviewSummary, list[models.Review], str | None]:
        path = (
            f"/v1/apps/{patterns.name(catalogue, 'catalogue')}/{patterns.name(app, 'app')}/reviews"
        )
        body = await self.open_read(path, params, language)
        try:
            summary = models.ReviewSummary.model_validate(_member(body, "summary"))
            items, _ = models.parse_items(models.Review, _member(body, "items"))
            return summary, items, _cursor(body)
        except ValueError as exc:
            raise not_the_format() from exc

    async def reports(self, catalogue: str, app: str, language: str | None) -> list[models.Report]:
        path = (
            f"/v1/apps/{patterns.name(catalogue, 'catalogue')}/{patterns.name(app, 'app')}/reports"
        )
        body = await self.open_read(path, None, language)
        try:
            return models.parse_items(models.Report, _member(body, "items"))[0]
        except ValueError as exc:
            raise not_the_format() from exc

    # ── the signed-in calls ─────────────────────────────────────────────────

    async def tenant(
        self, token: str, session: str, language: str | None = None
    ) -> models.TenantStanding:
        _, body, _ = await self.signed(
            "GET", "/v1/tenant", token, session=session, language=language
        )
        try:
            return models.TenantStanding.model_validate(body)
        except ValueError as exc:
            raise not_the_format() from exc

    async def acquisitions(self, token: str, session: str) -> list[models.Acquisition]:
        """Every acquisition of the token's tenant, newest first. A page that
        is not the format fails the whole read: half a list of what a tenant
        has would read as the tenant having less."""
        out: list[models.Acquisition] = []
        params = {"limit": "100"}
        for _ in range(10):
            _, body, _ = await self.signed(
                "GET", "/v1/acquisitions", token, session=session, params=params
            )
            try:
                raw_items = _member(body, "items")
                if not isinstance(raw_items, list):
                    raise models.NotTheShape("items is not a list")
                page = [models.Acquisition.model_validate(item) for item in raw_items]
                cursor = _cursor(body)
            except ValueError as exc:
                raise not_the_format() from exc
            for acquisition in page:
                # The listing never carries a credential. Were one there all
                # the same, it is not kept.
                if acquisition.confirmation is not None:
                    for item in acquisition.confirmation.items():
                        if item.repository is not None:
                            item.repository.credential = None
            out.extend(page)
            if cursor is None:
                break
            params = {"limit": "100", "cursor": cursor}
        return out

    async def acquire(
        self,
        token: str,
        session: str,
        coordinate: str,
        version: str | None,
        idempotency_key: str,
        language: str | None = None,
    ) -> tuple[models.Acquisition, int | None]:
        body: dict[str, str] = {"coordinate": patterns.coordinate(coordinate)}
        if version is not None:
            body["version"] = patterns.version(version)
        _, answer, retry_after = await self.signed(
            "POST",
            "/v1/acquisitions",
            token,
            session=session,
            json_body=body,
            idempotency_key=idempotency_key,
            language=language,
        )
        return _acquisition(answer, coordinate), retry_after

    async def acquisition(
        self,
        token: str,
        session: str,
        acquisition_id: str,
        version: str | None = None,
        language: str | None = None,
    ) -> tuple[models.Acquisition, int | None]:
        params = {"version": patterns.version(version)} if version is not None else None
        _, answer, retry_after = await self.signed(
            "GET",
            f"/v1/acquisitions/{patterns.acquisition_id(acquisition_id)}",
            token,
            session=session,
            params=params,
            language=language,
        )
        acquisition = _acquisition(answer, None)
        if acquisition.id != acquisition_id:
            raise not_the_format()
        return acquisition, retry_after

    async def replace_credential(
        self, token: str, session: str, acquisition_id: str
    ) -> models.Confirmation:
        _, answer, _ = await self.signed(
            "POST",
            f"/v1/acquisitions/{patterns.acquisition_id(acquisition_id)}/credential",
            token,
            session=session,
        )
        try:
            return models.Confirmation.model_validate(answer)
        except ValueError as exc:
            raise not_the_format() from exc


def _member(body: Any, key: str) -> Any:
    if not isinstance(body, dict) or key not in body:
        raise models.NotTheShape(f"no {key}")
    return body[key]


def _cursor(body: Any) -> str | None:
    value = _member(body, "nextCursor")
    if value is None:
        return None
    if not isinstance(value, str):
        raise models.NotTheShape("nextCursor is not a string")
    return value


def _acquisition(answer: Any, coordinate: str | None) -> models.Acquisition:
    try:
        acquisition = models.Acquisition.model_validate(answer)
    except ValueError as exc:
        raise not_the_format() from exc
    if coordinate is not None and acquisition.coordinate != coordinate:
        # Asked for one entry and answered another: not acted on.
        raise not_the_format()
    return acquisition


_stores: dict[str, Store] = {}


def get_store(settings: Settings) -> Store:
    """The store this cluster names, or a refusal saying it names none."""
    base = settings.store_base
    if not base:
        raise Refusal(status=503, source="app", code="store-not-configured")
    store = _stores.get(base)
    if store is None:
        store = _stores[base] = Store(base)
    return store


def reset() -> None:
    """Forget every cached answer and every gate. For the tests."""
    _stores.clear()
