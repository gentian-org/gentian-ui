"""Tenant security policy model and Keycloak password-policy helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

REQUIRE_TOTP_ADMINS_ATTR = "gentian.security.requireTotpAdmins"
REQUIRE_TOTP_MEMBERS_ATTR = "gentian.security.requireTotpMembers"

RequireTotpMembers = Literal["none", "optional", "required"]

_POLICY_PATTERN = re.compile(r"(\w+)\((\d+)\)")


@dataclass
class SecurityPolicies:
    password_min_length: int = 8
    password_require_digits: bool = False
    password_require_lowercase: bool = False
    password_require_uppercase: bool = False
    password_require_special_chars: bool = False
    password_history_count: int = 0
    password_max_age_days: int = 0
    sso_session_idle_minutes: int = 30
    sso_session_max_hours: int = 10
    remember_me: bool = False
    brute_force_protected: bool = True
    max_login_failures: int = 5
    lockout_duration_seconds: int = 900
    require_totp_admins: bool = False
    require_totp_members: RequireTotpMembers = "none"


def parse_password_policy(policy: str | None) -> dict[str, int | bool]:
    result: dict[str, int | bool] = {
        "password_min_length": 8,
        "password_require_digits": False,
        "password_require_lowercase": False,
        "password_require_uppercase": False,
        "password_require_special_chars": False,
        "password_history_count": 0,
        "password_max_age_days": 0,
    }
    if not policy:
        return result
    for match in _POLICY_PATTERN.finditer(policy):
        name, value = match.group(1), int(match.group(2))
        if name == "length":
            result["password_min_length"] = value
        elif name == "digits" and value > 0:
            result["password_require_digits"] = True
        elif name == "lowerCase" and value > 0:
            result["password_require_lowercase"] = True
        elif name == "upperCase" and value > 0:
            result["password_require_uppercase"] = True
        elif name == "specialChars" and value > 0:
            result["password_require_special_chars"] = True
        elif name == "passwordHistory":
            result["password_history_count"] = value
        elif name == "forceExpiredPasswordChange":
            result["password_max_age_days"] = value
    return result


def build_password_policy(policies: SecurityPolicies) -> str:
    parts = [f"length({max(4, policies.password_min_length)})"]
    if policies.password_require_digits:
        parts.append("digits(1)")
    if policies.password_require_lowercase:
        parts.append("lowerCase(1)")
    if policies.password_require_uppercase:
        parts.append("upperCase(1)")
    if policies.password_require_special_chars:
        parts.append("specialChars(1)")
    if policies.password_history_count > 0:
        parts.append(f"passwordHistory({policies.password_history_count})")
    if policies.password_max_age_days > 0:
        parts.append(f"forceExpiredPasswordChange({policies.password_max_age_days})")
    return " and ".join(parts)


def policies_from_realm(raw: dict) -> SecurityPolicies:
    parsed = parse_password_policy(raw.get("passwordPolicy"))
    attrs = raw.get("attributes") or {}
    require_admins = _attr_bool(attrs.get(REQUIRE_TOTP_ADMINS_ATTR))
    require_members = _attr_str(attrs.get(REQUIRE_TOTP_MEMBERS_ATTR), "none")
    if require_members not in {"none", "optional", "required"}:
        require_members = "none"
    idle = int(raw.get("ssoSessionIdleTimeout") or 1800)
    max_life = int(raw.get("ssoSessionMaxLifespan") or 36000)
    return SecurityPolicies(
        password_min_length=int(parsed["password_min_length"]),
        password_require_digits=bool(parsed["password_require_digits"]),
        password_require_lowercase=bool(parsed["password_require_lowercase"]),
        password_require_uppercase=bool(parsed["password_require_uppercase"]),
        password_require_special_chars=bool(parsed["password_require_special_chars"]),
        password_history_count=int(parsed["password_history_count"]),
        password_max_age_days=int(parsed["password_max_age_days"]),
        sso_session_idle_minutes=max(1, idle // 60),
        sso_session_max_hours=max(1, max_life // 3600),
        remember_me=bool(raw.get("rememberMe", False)),
        brute_force_protected=bool(raw.get("bruteForceProtected", True)),
        max_login_failures=int(raw.get("failureFactor") or 5),
        lockout_duration_seconds=int(raw.get("maxFailureWaitSeconds") or 900),
        require_totp_admins=require_admins,
        require_totp_members=require_members,  # type: ignore[arg-type]
    )


def policies_to_realm_update(raw: dict, policies: SecurityPolicies) -> dict:
    attrs = dict(raw.get("attributes") or {})
    attrs[REQUIRE_TOTP_ADMINS_ATTR] = ["true" if policies.require_totp_admins else "false"]
    attrs[REQUIRE_TOTP_MEMBERS_ATTR] = [policies.require_totp_members]
    return {
        **raw,
        "passwordPolicy": build_password_policy(policies),
        "ssoSessionIdleTimeout": policies.sso_session_idle_minutes * 60,
        "ssoSessionMaxLifespan": policies.sso_session_max_hours * 3600,
        "rememberMe": policies.remember_me,
        "bruteForceProtected": policies.brute_force_protected,
        "failureFactor": max(1, policies.max_login_failures),
        "maxFailureWaitSeconds": max(60, policies.lockout_duration_seconds),
        "permanentLockout": False,
        "attributes": attrs,
    }


def _attr_bool(values: list[str] | None) -> bool:
    if not values:
        return False
    return values[0].lower() in {"true", "1", "yes"}


def _attr_str(values: list[str] | None, default: str) -> str:
    if not values:
        return default
    return values[0]
