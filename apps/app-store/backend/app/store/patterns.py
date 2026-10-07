"""The identifiers this app puts into an upstream path or body, and their patterns.

Each is the store API definition's own pattern. An identifier is checked
before it is spelled into a URL: a coordinate half with a dot-dot or a slash
in it would address another route of the store or of the director than the
one written, and an acquisition id is the store's word, arriving from outside.
None of this is an authorisation check.
"""

import re

from app.core.problems import Refusal

NAME_PATTERN = r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"
COORDINATE_PATTERN = r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"
DIGEST_PATTERN = r"^sha256:[0-9a-f]{64}$"
ACQUISITION_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
REPOSITORY_URL_PATTERN = r"^oci://[^\s/@]+(/[^\s@]+)?$"

_NAME = re.compile(NAME_PATTERN)
_COORDINATE = re.compile(COORDINATE_PATTERN)
_DIGEST = re.compile(DIGEST_PATTERN)
_ACQUISITION_ID = re.compile(ACQUISITION_ID_PATTERN)
# Python's $ also matches before a trailing newline; fullmatch does not.
_CURSOR = re.compile(r"[\x21-\x7e]{1,1024}")
_VERSION = re.compile(r"[\x21-\x7e]{1,64}")


def invalid(what: str) -> Refusal:
    return Refusal(status=400, source="app", code="invalid-request", detail=what)


def name(value: str, what: str = "name") -> str:
    if not isinstance(value, str) or not _NAME.fullmatch(value):
        raise invalid(f"That is not a valid {what}.")
    return value


def coordinate(value: str) -> str:
    if not isinstance(value, str) or not _COORDINATE.fullmatch(value):
        raise invalid("A coordinate is <catalogue>/<app>.")
    return value


def app_of(coordinate_value: str) -> str:
    """The app half of a coordinate: the {p} of the director's routes."""
    return coordinate(coordinate_value).split("/", 1)[1]


def digest(value: str) -> str:
    if not isinstance(value, str) or not _DIGEST.fullmatch(value):
        raise invalid("A digest is sha256: and 64 lower-case hexadecimal characters.")
    return value


def acquisition_id(value: str) -> str:
    if not isinstance(value, str) or not _ACQUISITION_ID.fullmatch(value):
        raise invalid("That is not an acquisition's id.")
    return value


def cursor(value: str) -> str:
    """Opaque, and the store's own: passed back unchanged, as a query value."""
    if not isinstance(value, str) or not _CURSOR.fullmatch(value):
        raise invalid("That is not a cursor.")
    return value


def version(value: str) -> str:
    if not isinstance(value, str) or not _VERSION.fullmatch(value):
        raise invalid("That is not a version.")
    return value
