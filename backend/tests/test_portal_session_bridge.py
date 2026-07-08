"""Tests for portal bridge tickets."""

import jwt
from app.core.config import Settings
from app.services.portal_session_bridge import (
    create_portal_bridge_ticket,
    is_allowed_tenant_origin,
    redeem_portal_bridge_ticket,
)


def test_is_allowed_tenant_origin():
    settings = Settings(KERNEL_DOMAIN="desk.gentian.org")
    assert is_allowed_tenant_origin("https://cloud.demo.desk.gentian.org", settings) is True
    assert is_allowed_tenant_origin("https://projects.demo.desk.gentian.org", settings) is True
    assert is_allowed_tenant_origin("https://cloud.demo.desk.gentian.org/", settings) is True
    assert is_allowed_tenant_origin("http://cloud.demo.desk.gentian.org", settings) is False
    assert is_allowed_tenant_origin("https://invalid.desk.gentian.org", settings) is False
    assert is_allowed_tenant_origin("https://cloud.demo.other.org", settings) is False


def test_portal_bridge_ticket_roundtrip():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    claims = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "name": "John Doe",
        "email": "john.doe@desk.gentian.org",
        "groups": ["App Users"],
    }
    ticket = create_portal_bridge_ticket(claims, tenant="demo", settings=settings)
    payload = redeem_portal_bridge_ticket(ticket, settings)

    assert payload["username"] == "john-doe"
    assert payload["name"] == "John Doe"
    assert payload["email"] == "john.doe@desk.gentian.org"
    assert payload["tenant"] == "demo"
    assert payload["groups"] == ["App Users"]


def test_portal_bridge_ticket_rejects_tampered_token():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    bad = jwt.encode({"u": "john-doe"}, "wrong-secret", algorithm="HS256")
    try:
        redeem_portal_bridge_ticket(bad, settings)
        raised = False
    except Exception:
        raised = True
    assert raised
