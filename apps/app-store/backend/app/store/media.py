"""A store's pictures, fetched here and handed to the browser from this origin.

A store's answers name images by address: icons and screenshots. The browser
never loads one from the store. This API fetches it and serves the bytes
itself, which is what lets the pages' content security policy say
`img-src 'self'` and nothing wider -- a policy that named the store's media
origins would have to be written from an answer only known at run time, by a
static server that cannot know it.

What is fetched, and what is handed on:

* only an https address on an origin `GET /v1/meta` lists in `mediaOrigins`,
  and only when that origin is a public host;
* with no cookie, no `Referer`, no language and no token: the request tells
  the store's media host that this cluster asked for the picture, and nothing
  about who is looking at it;
* only PNG, JPEG or WebP -- by the answer's own `Content-Type` and by the
  bytes, which must agree. SVG is not accepted: it is a document that can
  carry script;
* no more than `MAX_IMAGE_BYTES`.

Anything else is not served, and the screen shows a placeholder.
"""

from urllib.parse import quote

from app.core.problems import Refusal
from app.store.client import USER_AGENT, Store, as_origin, assert_public, fetch, origin_of
from app.store.models import Meta

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_URL_LENGTH = 2048
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")


def media_origins(meta: Meta) -> set[str]:
    return {o for o in map(as_origin, meta.mediaOrigins) if o is not None}


def checkout_origins(meta: Meta) -> set[str]:
    return {o for o in map(as_origin, meta.checkoutOrigins) if o is not None}


def proxied(url: str | None, origins: set[str]) -> str | None:
    """This API's own address for a store image, or None when the image is
    not on an origin the store's meta lists."""
    if not url or len(url) > MAX_URL_LENGTH or origin_of(url) not in origins:
        return None
    return "/api/v1/media?u=" + quote(url, safe="")


def sniff(content: bytes) -> str | None:
    """What the bytes are, from how they begin."""
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _refused() -> Refusal:
    return Refusal(status=404, source="app", code="image-refused")


async def fetch_image(store: Store, url: str) -> tuple[str, bytes]:
    if len(url) > MAX_URL_LENGTH:
        raise _refused()
    origin = origin_of(url)
    if origin is None or origin not in media_origins(await store.meta()):
        raise _refused()
    await assert_public(url)
    raw = await fetch(
        "GET",
        url,
        allowed_origin=origin,
        headers={"User-Agent": USER_AGENT, "Accept": ", ".join(IMAGE_TYPES)},
        max_bytes=MAX_IMAGE_BYTES,
    )
    if raw.status != 200:
        raise _refused()
    declared = raw.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if declared not in IMAGE_TYPES or sniff(raw.content) != declared:
        raise _refused()
    return declared, raw.content
