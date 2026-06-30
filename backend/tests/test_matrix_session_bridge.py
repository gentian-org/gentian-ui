"""Tests for Matrix session bridge helpers."""

import jwt
import pytest
from fastapi import HTTPException

from app.core.config import Settings
from app.services.matrix_session_bridge import (
    is_allowed_app_origin,
    matrix_homeserver_url,
    matrix_localpart_from_claims,
    matrix_user_id,
    redeem_matrix_bridge_ticket,
)


def test_matrix_localpart_from_email_username():
    claims = {"preferred_username": "john-doe@demo.desk.gentian.org"}
    assert matrix_localpart_from_claims(claims) == "john-doe"


def test_matrix_urls_use_tenant_subdomain():
    assert matrix_homeserver_url("demo", "desk.gentian.org") == "https://matrix.demo.desk.gentian.org"
    assert matrix_user_id("john-doe", "demo", "desk.gentian.org") == "@john-doe:demo.desk.gentian.org"


def test_allowed_app_origin_matches_chat_host():
    settings = Settings(KERNEL_DOMAIN="desk.gentian.org")
    assert is_allowed_app_origin("https://chat.demo.desk.gentian.org", settings)
    assert not is_allowed_app_origin("https://portal.desk.gentian.org", settings)


def test_matrix_bridge_ticket_rejects_tampered_token():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="bridge-test-secret")
    bad = jwt.encode(
        {"uid": "@x:y", "hs": "https://matrix.demo.desk.gentian.org", "at": "nope"},
        "wrong",
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as exc:
        redeem_matrix_bridge_ticket(bad, settings)
    assert exc.value.status_code == 401


def test_matrix_bridge_ticket_roundtrip():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="bridge-test-secret")
    ticket = jwt.encode(
        {
            "hs": "https://matrix.demo.desk.gentian.org",
            "uid": "@john-doe:demo.desk.gentian.org",
            "at": "syt_test_token",
        },
        settings.portal_bff_client_secret,
        algorithm="HS256",
    )
    session = redeem_matrix_bridge_ticket(ticket, settings)
    assert session["userId"] == "@john-doe:demo.desk.gentian.org"
    assert session["homeServerUrl"] == "https://matrix.demo.desk.gentian.org"
    assert session["accessToken"] == "syt_test_token"
