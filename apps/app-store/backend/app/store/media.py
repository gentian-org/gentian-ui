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
* PNG, JPEG or WebP -- by the answer's own `Content-Type` and by the
  bytes, which must agree;
* or SVG, which is how stores draw icons, held to more: it is a document
  that can carry script and point elsewhere, so one is served only when it
  is a lone `<svg>` element with nothing in it that runs or loads anything
  -- no script, no event attribute, no foreign object, no document type, no
  reference outside itself (`svg_is_inert`). It is shown by `<img>`, where a
  browser runs no script in it anyway, and answered with a policy that lets
  nothing run should somebody open the address itself;
* no more than `MAX_IMAGE_BYTES`, and `MAX_SVG_BYTES` for an SVG.

Anything else is not served, and the screen shows a placeholder.
"""

import re
from urllib.parse import quote
from xml.etree import ElementTree

from app.core.problems import Refusal
from app.store.client import USER_AGENT, Store, as_origin, assert_public, fetch, origin_of
from app.store.models import Meta

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_URL_LENGTH = 2048
MAX_SVG_BYTES = 256 * 1024
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
SVG_TYPE = "image/svg+xml"
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}"

# Elements that run, embed or load something, by local name and in any case.
_SVG_REFUSED_ELEMENTS = {
    "script",
    "foreignobject",
    "iframe",
    "embed",
    "object",
    "audio",
    "video",
    "image",
    "feimage",
    "handler",
    "listener",
    "set",
    "animate",
    "animatemotion",
    "animatetransform",
}
# url(#id) is a reference within the document; any other url(...) is not.
_SVG_OUTSIDE_URL = re.compile(r"url\(\s*['\"]?\s*(?!#)", re.IGNORECASE)


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


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1].lower()


def svg_is_inert(content: bytes) -> bool:
    """Whether an SVG is a picture and nothing else: one `<svg>` element,
    nothing in it that runs or loads, no reference outside itself."""
    if len(content) > MAX_SVG_BYTES:
        return False
    lowered = content.lower()
    # No document type, so no entity can be declared and none expanded; no
    # stylesheet processing instruction.
    if b"<!doctype" in lowered or b"<!entity" in lowered or b"<?xml-stylesheet" in lowered:
        return False
    if b"@import" in lowered or b"javascript:" in lowered:
        return False
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return False
    if root.tag != f"{SVG_NAMESPACE}svg":
        return False
    for element in root.iter():
        if not isinstance(element.tag, str) or _local(element.tag) in _SVG_REFUSED_ELEMENTS:
            return False
        if _local(element.tag) == "style" and _SVG_OUTSIDE_URL.search(element.text or ""):
            return False
        for name, value in element.attrib.items():
            local = _local(name)
            if local.startswith("on"):
                return False
            if local == "href" and not value.strip().startswith("#"):
                return False
            if _SVG_OUTSIDE_URL.search(value):
                return False
    return True


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
        headers={"User-Agent": USER_AGENT, "Accept": ", ".join((*IMAGE_TYPES, SVG_TYPE))},
        max_bytes=MAX_IMAGE_BYTES,
    )
    if raw.status != 200:
        raise _refused()
    declared = raw.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if declared == SVG_TYPE:
        if sniff(raw.content) is not None or not svg_is_inert(raw.content):
            raise _refused()
        return declared, raw.content
    if declared not in IMAGE_TYPES or sniff(raw.content) != declared:
        raise _refused()
    return declared, raw.content
