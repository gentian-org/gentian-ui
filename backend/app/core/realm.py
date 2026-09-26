"""Which realm an issuer names.

A pure function of the issuer URL, and that is the whole module. It used to sit
in a service that also held a Keycloak administrator credential and looked up
other people's groups with it; keeping one string parse there meant every caller
of the parse imported the credential too. The credential is gone
(gentian-os S7A.6) and this is what was worth keeping.
"""


def realm_from_issuer(issuer: str) -> str | None:
    """The realm in `https://host/realms/<realm>`, or None if there is none."""
    normalized = issuer.rstrip("/")
    marker = "/realms/"
    if marker not in normalized:
        return None
    realm = normalized.split(marker, 1)[1]
    return realm or None
