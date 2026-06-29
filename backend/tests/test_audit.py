"""Tests for audit event normalization."""

from app.services.keycloak_audit_fetcher import KeycloakAuditFetcher


def test_user_event_from_raw_maps_login():
    event = KeycloakAuditFetcher._user_event_from_raw(
        "demo",
        {
            "time": 1_700_000_000_000,
            "type": "LOGIN",
            "clientId": "gentian-portal",
            "ipAddress": "203.0.113.4",
            "details": {"username": "alice@demo.desk.gentian.org"},
        },
    )
    assert event.category == "sign_in"
    assert event.action == "LOGIN"
    assert event.actor == "alice@demo.desk.gentian.org"
    assert event.target == "gentian-portal"
    assert event.success is True


def test_admin_event_from_raw_maps_group_membership():
    event = KeycloakAuditFetcher._admin_event_from_raw(
        "demo",
        {
            "time": 1_700_000_100_000,
            "operationType": "CREATE",
            "resourceType": "GROUP_MEMBERSHIP",
            "resourcePath": "users/u1/groups/g1",
            "authDetails": {"username": "administrator", "ipAddress": "10.0.0.2"},
        },
    )
    assert event.category == "entitlement"
    assert event.action == "GROUP_MEMBERSHIP.CREATE"
    assert event.actor == "administrator"
