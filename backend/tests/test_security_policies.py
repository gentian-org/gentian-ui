from app.services.security_policies import (
    SecurityPolicies,
    build_password_policy,
    parse_password_policy,
    policies_from_realm,
    policies_to_realm_update,
)


def test_build_and_parse_password_policy():
    policies = SecurityPolicies(
        password_min_length=12,
        password_require_digits=True,
        password_require_uppercase=True,
        password_history_count=3,
        password_max_age_days=90,
    )
    encoded = build_password_policy(policies)
    parsed = parse_password_policy(encoded)
    assert parsed["password_min_length"] == 12
    assert parsed["password_require_digits"] is True
    assert parsed["password_require_uppercase"] is True
    assert parsed["password_history_count"] == 3
    assert parsed["password_max_age_days"] == 90


def test_policies_from_realm_round_trip():
    raw = {
        "passwordPolicy": "length(10) and digits(1) and passwordHistory(2)",
        "ssoSessionIdleTimeout": 1200,
        "ssoSessionMaxLifespan": 72000,
        "rememberMe": True,
        "bruteForceProtected": True,
        "failureFactor": 7,
        "maxFailureWaitSeconds": 600,
        "attributes": {
            "gentian.security.requireTotpAdmins": ["true"],
            "gentian.security.requireTotpMembers": ["required"],
        },
    }
    policies = policies_from_realm(raw)
    assert policies.password_min_length == 10
    assert policies.password_require_digits is True
    assert policies.password_history_count == 2
    assert policies.sso_session_idle_minutes == 20
    assert policies.sso_session_max_hours == 20
    assert policies.remember_me is True
    assert policies.max_login_failures == 7
    assert policies.require_totp_admins is True
    assert policies.require_totp_members == "required"

    updated = policies_to_realm_update(raw, policies)
    assert updated["passwordPolicy"] == build_password_policy(policies)
    assert updated["ssoSessionIdleTimeout"] == 1200
