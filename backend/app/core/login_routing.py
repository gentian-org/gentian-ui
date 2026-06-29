"""Resolve portal login to kernel-native auth or a tenant IdP broker hint."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

_ADMIN_LOCAL_RE = re.compile(r"^admin-([a-z0-9-]+)$")


@dataclass(frozen=True)
class LoginRoute:
    login_hint: str
    idp_hint: str | None
    kind: Literal["platform", "tenant"]


def resolve_login_route(email: str, *, kernel_domain: str, tenancy_mode: str = "multi") -> LoginRoute:
    """Map an email address to the kernel portal OIDC route.

    Platform operators authenticate natively in the kernel realm. Tenant members
    (including bootstrap admins ``admin-<tenant>@…``) broker to the tenant realm.
    """
    normalized = email.strip().lower()
    if not normalized or "@" not in normalized:
        raise ValueError("Enter a valid email address")

    local, domain = normalized.split("@", 1)
    kernel_domain = kernel_domain.strip().lower()
    if not kernel_domain:
        raise ValueError("KERNEL_DOMAIN is not configured")

    admin_match = _ADMIN_LOCAL_RE.match(local)
    if admin_match:
        return LoginRoute(
            login_hint=normalized,
            idp_hint=admin_match.group(1),
            kind="tenant",
        )

    if domain == kernel_domain:
        return LoginRoute(login_hint=normalized, idp_hint=None, kind="platform")

    if tenancy_mode.strip().lower() == "multi" and domain.endswith("." + kernel_domain):
        tenant = domain[: -(len(kernel_domain) + 1)]
        if tenant and "." not in tenant:
            return LoginRoute(login_hint=normalized, idp_hint=tenant, kind="tenant")

    raise ValueError("No Gentian workspace found for this email address")
