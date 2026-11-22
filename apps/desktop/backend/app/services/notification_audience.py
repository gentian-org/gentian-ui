"""Who a notice is for, and whether a person is among them."""

from __future__ import annotations

from typing import Any

from app.core.rights import positions_of, user_is_platform_admin
from app.services.admin_notifications import AdminNotification, NotificationAudience

# The position every person of a tenant holds: a tenant notice that names
# nobody is for its holders.
EVERYONE = "user"


def normalize_audience(audience: NotificationAudience, default_tenant: str) -> NotificationAudience:
    tenant = audience.tenant or default_tenant
    positions = list(audience.positions)
    people = list(audience.people)
    # A notice that names people and no position is for those people alone:
    # every person of the tenant is the default only for an audience that
    # names nobody.
    if audience.scope == "tenant" and not positions and not people and not audience.groups:
        positions = [EVERYONE]
    return NotificationAudience(
        scope=audience.scope, tenant=tenant, positions=positions, people=people, groups=list(audience.groups)
    )


def notification_visible_to_user(
    notification: AdminNotification,
    user: dict[str, Any],
    *,
    user_tenant: str | None,
) -> bool:
    import time

    if notification.expires_at and notification.expires_at <= int(time.time() * 1000):
        return False

    audience = notification.audience

    if audience.scope == "platform":
        return True

    if audience.tenant and user_tenant and audience.tenant != user_tenant:
        if not user_is_platform_admin(user):
            return False

    if audience_names_person(audience, user):
        return True

    targets = list(audience.positions)
    if not targets and not audience.people:
        # A notice stored while audiences named groups, and naming nothing
        # else, is for nobody: read as naming no one it would reach every
        # person of the tenant, which is wider than it was written for.
        if audience.groups:
            return False
        targets = [EVERYONE]
    return bool(set(positions_of(user)).intersection(targets))


def audience_names_person(audience: NotificationAudience, user: dict[str, Any]) -> bool:
    """Whether one of the audience's people is this user.

    An entry names a person by subject, by username or by email address. The
    subject is compared as it is; a username and an address without regard to
    case. A claim the token does not carry, or carries empty, matches nothing.
    """
    sub = _claim(user, "sub")
    names = {name.casefold() for name in (_claim(user, "preferred_username"), _claim(user, "email")) if name}
    for entry in audience.people:
        entry = str(entry).strip()
        if not entry:
            continue
        if (sub and entry == sub) or entry.casefold() in names:
            return True
    return False


def _claim(user: dict[str, Any], name: str) -> str:
    value = user.get(name)
    return value.strip() if isinstance(value, str) else ""
