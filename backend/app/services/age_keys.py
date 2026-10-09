"""age key pairs, for a tenant that wants backups the platform cannot read.

Scheduled backups have to use a key rather than a passphrase — there is nobody
to type one at 03:00 — and until now the only key available was the cluster's.
That makes every unattended backup readable by whoever holds the cluster's
identity, which is the right default (support can help restore) and the wrong
one for a tenant whose whole reason for asking is that it should not be.

A tenant can now name its own recipient. The operator already honoured one:
ExportEncryption.recipients replaces the cluster's rather than adding to it,
deliberately, because appending would leave the platform able to read a bundle
somebody asked to be readable only by them.

Two ways to get one, and the difference matters:

  - Bring your own. Run `age-keygen` where nobody else is, paste the public
    half. The private key never exists here, so nothing about this service —
    compromised, subpoenaed or merely curious — can read the bundles.

  - Mint here. Convenient, and weaker: the identity is generated in this
    process and returned once. It is never written to disk, a database or a
    log, but it does exist in this service's memory for the length of one
    request, and a caller has to trust that.

The first is what the feature is for. The second exists because a tenant
administrator without a terminal would otherwise have no route at all, and an
unavailable option is not more secure than a documented one.
"""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

# age identities are X25519 keys in bech32, per the age specification: the
# public half under the "age" prefix, the private half under "AGE-SECRET-KEY-"
# and uppercased. bech32 rather than base64 because it carries a checksum — a
# key misread off paper or a QR code is detected rather than silently wrong,
# which is the property that makes an offline copy usable.
_RECIPIENT_HRP = "age"
_IDENTITY_HRP = "AGE-SECRET-KEY-"

_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values: list[int]) -> int:
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def _hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _convertbits(data: bytes, frombits: int, tobits: int, pad: bool) -> list[int]:
    acc = 0
    bits = 0
    ret: list[int] = []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def _bech32_encode(hrp: str, data: bytes) -> str:
    values = _convertbits(data, 8, 5, True)
    checksum_input = _hrp_expand(hrp) + values + [0, 0, 0, 0, 0, 0]
    polymod = _polymod(checksum_input) ^ 1
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(_CHARSET[d] for d in values + checksum)


def mint() -> tuple[str, str]:
    """Generate an age key pair. Returns (identity, recipient).

    The identity is returned to the caller and kept nowhere: not written, not
    logged, not stored. Whoever asked for it has the only copy from the moment
    the response is sent, which is the point and also the risk — a tenant that
    loses it cannot read its own backups, and nobody can help.
    """
    private = X25519PrivateKey.generate()
    raw_private = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    raw_public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    identity = _bech32_encode(_IDENTITY_HRP.lower(), raw_private).upper()
    recipient = _bech32_encode(_RECIPIENT_HRP, raw_public)
    return identity, recipient


def looks_like_recipient(value: str) -> bool:
    """Whether a string is plausibly an age public key.

    A shape check, not a validation: the bech32 checksum is what actually
    catches a mistyped key, and age itself does that when it encrypts. Refusing
    obvious nonsense here means the person sees it while the form is in front of
    them rather than at 03:00 in an export's status.
    """
    value = value.strip()
    return (
        value.startswith(_RECIPIENT_HRP + "1")
        and len(value) == 62
        and all(c in _CHARSET for c in value[4:])
    )
