# SPDX-License-Identifier: Apache-2.0
"""The store's sign-in through the tenant's own realm (store-contract.md §6.1).

Once the store has associated this tenant with a store account, its realm
signs a person in through the tenant's realm, which has their session: the
store's identity provider for it is `org-<tenant uid>`, keyed by the tenant's
unique id (metadata.uid) and never by its name. Two things here:

* the sign-in names that provider (`kc_idp_hint`) and first asks with
  `prompt=none`; any error at the issuer sends the browser on to the visible
  sign-in, still with the hint (`app.store.oauth`);
* after a sign-in whose standing says the store associated this tenant's
  uid, the director is asked to turn the tenant's side on
  (`spec.store.signIn`), with the person's own token. Only the tenant's
  administrators may; for anybody else the director refuses, and nothing
  more is done or shown.
"""

import re

from app.core import director
from app.core.config import Settings
from app.core.problems import Refusal
from app.store import models, patterns

FEATURE = "tenant-sign-in"
_UID = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")

# The issuer the director last confirmed the tenant's side for, so a sign-in
# does not ask it again.
_confirmed: set[str] = set()


def reset() -> None:
    """For the tests."""
    _confirmed.clear()


def uid(settings: Settings) -> str | None:
    value = settings.tenant_uid.strip()
    return value if _UID.fullmatch(value) else None


def hint(settings: Settings, meta: models.Meta) -> str | None:
    """The store's provider for this tenant, where the store offers the
    sign-in and the cluster told this app the tenant's uid."""
    tenant_uid = uid(settings)
    if tenant_uid is None or FEATURE not in meta.features:
        return None
    return f"org-{tenant_uid}"


async def turn_on(
    settings: Settings, meta: models.Meta, standing: models.TenantStanding, token: str | None
) -> bool:
    """Ask the director to turn the tenant's side on, when the store
    associated this tenant's uid. True when it is on. A refusal or a
    director that cannot be reached is not an error of the sign-in."""
    tenant_uid = uid(settings)
    issuer = meta.issuer.rstrip("/")
    if (
        not token
        or tenant_uid is None
        or FEATURE not in meta.features
        or standing.signIn is None
        or standing.signIn.tenantUid != tenant_uid
    ):
        return False
    if issuer in _confirmed:
        return True
    try:
        path = f"/v1/tenants/{patterns.name(settings.tenant_id, 'tenant')}/store-sign-in"
        have = await director.ask_director(settings, "GET", path, token)
        if have.status == 200 and isinstance(have.body, dict) and have.body.get("issuer") == issuer:
            _confirmed.add(issuer)
            return True
        put = await director.ask_director(
            settings, "PUT", path, token, json_body={"issuer": issuer}
        )
    except Refusal:
        return False
    if put.status in (200, 202):
        _confirmed.add(issuer)
        return True
    return False
