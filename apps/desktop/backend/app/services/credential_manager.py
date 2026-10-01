"""Proving the cluster's human write path at login.

The gentian-os installer holds a bootstrap credential that can write every
secret in the cluster, and its last step destroys it. After that the only way
to write one is the credential manager, which holds no token of its own: it
exchanges the caller's Keycloak token for a short-lived OpenBao token.

That exchange has conditions nothing else exercises — the OpenBao role's bound
audience, its bound group claim matching what Keycloak actually emits, and the
policy attaching — and it needs a human at a browser, so no installer step can
perform it. gentian-os therefore refuses to destroy the bootstrap credential
until it has SEEN one succeed, and records the first success in the
gentian-handover ConfigMap.

Until this module existed the only thing that performed an exchange was the
admin console's Credentials tab. Signing in proved nothing, so a cluster's
handover waited on an administrator happening to open one particular page —
and the instruction "sign in to the portal" was, in the strict sense, wrong.

Calling it here makes signing in the proof.
"""

import httpx

from app.core.config import Settings

# Short. This runs inside a login and is not worth delaying it for: the proof
# is recorded when the exchange succeeds, and a slow OpenBao simply means it is
# recorded at the next sign-in instead.
_TIMEOUT = httpx.Timeout(5.0)


async def prove_write_path(token: str, settings: Settings) -> bool:
    """Exchange the caller's token once, so the cluster observes that it works.

    Returns whether the exchange succeeded. Callers are expected to ignore it —
    it exists for tests, and because a function that reports nothing invites a
    caller to assume success.

    Any listing endpoint would do; /v1/credentials is used because every handler
    goes through the same identify() and the response is discarded either way.
    Nothing is written, and no credential value is read: this is the cheapest
    authenticated call the service offers.
    """
    base = getattr(settings, "credential_manager_url", None)
    if not base or not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(
                f"{base.rstrip('/')}/v1/credentials",
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception:
        # Unreachable, slow, or refusing connections. A login must not fail
        # because the credential manager is having a bad day.
        return False
    return response.status_code == 200
