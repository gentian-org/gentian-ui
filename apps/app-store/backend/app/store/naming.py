"""The name a store's repository is declared under on the cluster.

A store names nothing on the cluster. A confirmation carries a repository's
type and address, and the name of the Repository claim is computed here, from
the tenant's name on the cluster -- the {t} of the director's routes -- and
that address:

    address = url without the leading "oci://", lower-cased
    slug    = address with every run of characters outside [a-z0-9]
              replaced by one "-", then leading and trailing "-" removed
    hash    = the first 8 hexadecimal characters, lower case, of
              SHA-256( tenant + LF + address ), UTF-8; LF is the one byte 0x0A
    stem    = tenant + "-" + slug, cut to its first 31 characters,
              then trailing "-" removed
    name    = stem + "-" + hash                    (at most 40 characters)

The same tenant and the same address always give the same name, so a second
app from one registry declares nothing new. The hash is always there: the
readable part alone is ambiguous, because a hyphen is all a name has to
separate with.

This is the one implementation. Nothing else in this app spells a
repository's name.
"""

import hashlib
import re

_SCHEME = "oci://"
_NOT_SLUG = re.compile(r"[^a-z0-9]+")
_STEM_LENGTH = 31


def repository_name(tenant: str, url: str) -> str:
    """The Repository claim's name for `url` in `tenant`."""
    if not url.startswith(_SCHEME):
        raise ValueError("a store's repository is an OCI registry: oci://<host>[/<path>]")
    address = url[len(_SCHEME) :].lower()
    slug = _NOT_SLUG.sub("-", address).strip("-")
    digest = hashlib.sha256(f"{tenant}\n{address}".encode()).hexdigest()[:8]
    stem = f"{tenant}-{slug}"[:_STEM_LENGTH].rstrip("-")
    return f"{stem}-{digest}"


def credential_name(repository: str) -> str:
    """What the custodian calls a repository's credential."""
    return f"repository-{repository}"
