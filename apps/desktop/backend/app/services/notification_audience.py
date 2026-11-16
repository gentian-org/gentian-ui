"""Audience validation and inbox matching for admin notifications."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from app.core.gentian_groups import (
    is_platform_managed_group,
    is_platform_superadmin,
    is_tenant_managed_group,
    normalize_groups,
    tenant_members_group,
    tenant_prefix,
    user_is_platform_admin,
)
from app.services.admin_notifications import AdminNotification, NotificationAudience


def normalize_audience(audience: NotificationAudience, default_tenant: str) -> NotificationAudience:
    tenant = audience.tenant or default_tenant
    groups = list(audience.groups)
    people = list(audience.people)
    # A notice that names people and no group is for those people alone: the
    # members' group is the default only for an audience that names nobody.
    if audience.scope == "tenant" and not groups and not people:
        groups = [tenant_members_group(tenant)]
    return NotificationAudience(scope=audience.scope, tenant=tenant, groups=groups, people=people)


def validate_publish_audience(
    user: dict[str, Any],
    *,
    resolved_tenant: str,
    kernel_realm: str,
    audience: NotificationAudience,
    auth_disabled: bool = False,
) -> NotificationAudience:
    if auth_disabled:
        return normalize_audience(audience, resolved_tenant)

    normalized = normalize_audience(audience, resolved_tenant)
    groups = normalize_groups(user)
    is_platform = user_is_platform_admin(user)

    if normalized.scope == "platform":
        if not is_platform:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only platform administrators may publish platform-wide notifications",
            )
        return normalized

    if normalized.scope != "tenant":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="audience.scope must be platform or tenant",
        )

    if not normalized.tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="audience.tenant is required for tenant-scoped notifications",
        )

    if is_platform:
        if normalized.tenant not in {resolved_tenant, kernel_realm} and not is_platform_superadmin(groups):
            pass
    elif normalized.tenant != resolved_tenant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot publish notifications outside your tenant scope",
        )

    for group in normalized.groups:
        if normalized.tenant == kernel_realm:
            if not is_platform_managed_group(group):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Group {group} is outside platform notification scope",
                )
        elif not is_tenant_managed_group(group, normalized.tenant) and group != tenant_members_group(
            normalized.tenant
        ):
            if not group.startswith(tenant_prefix(normalized.tenant)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Group {group} is outside tenant {normalized.tenant}",
                )

    return normalized


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
    user_groups = set(normalize_groups(user))

    if audience.scope == "platform":
        return True

    if audience.tenant and user_tenant and audience.tenant != user_tenant:
        if not user_is_platform_admin(user):
            return False

    if audience_names_person(audience, user):
        return True

    target_groups = list(audience.groups)
    # No group named means every member of the tenant -- unless the notice
    # names people, and then it is for them and nobody else.
    if not target_groups and not audience.people:
        target_groups = [tenant_members_group(audience.tenant or notification.tenant)]
    return bool(user_groups.intersection(target_groups))


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
