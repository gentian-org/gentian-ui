"""Tests for Nextcloud portal bridge tickets."""

from unittest.mock import patch

import jwt

from app.core.config import Settings
from app.services.nextcloud_session_bridge import (
    create_nextcloud_bridge_ticket,
    nextcloud_uid_from_claims,
    redeem_nextcloud_bridge_ticket,
)


def test_nextcloud_uid_from_claims_prefers_opendesk_username():
    assert (
        nextcloud_uid_from_claims(
            {"opendesk_username": "john-doe", "preferred_username": "john-doe@demo.desk.gentian.org"}
        )
        == "john-doe"
    )


def test_nextcloud_bridge_ticket_roundtrip():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    claims = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "name": "John Doe",
    }
    with patch(
        "app.services.nextcloud_session_bridge.create_nextcloud_bridge_session",
        return_value={"username": "john-doe", "password": "portal-temp-password"},
    ):
        ticket = create_nextcloud_bridge_ticket(claims, tenant="demo", settings=settings)
    session = redeem_nextcloud_bridge_ticket(ticket, settings)
    assert session == {"username": "john-doe", "password": "portal-temp-password"}


def test_nextcloud_bridge_ticket_rejects_tampered_token():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    bad = jwt.encode({"u": "john-doe", "p": "pw"}, "wrong-secret", algorithm="HS256")
    try:
        redeem_nextcloud_bridge_ticket(bad, settings)
        raised = False
    except Exception:
        raised = True
    assert raised
