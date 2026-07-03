"""Tests for OpenProject portal bridge tickets."""

from unittest.mock import MagicMock, patch

import jwt
import pytest

from app.core.config import Settings
from app.services.openproject_session_bridge import (
    create_openproject_bridge_ticket,
    openproject_login_from_claims,
    redeem_openproject_bridge_ticket,
)


def test_openproject_login_from_claims_prefers_gentian_username():
    assert (
        openproject_login_from_claims(
            {
                "gentian_username": "john-doe",
                "preferred_username": "john-doe@demo.desk.gentian.org",
            }
        )
        == "john-doe"
    )


def test_ensure_openproject_user_updates_password_when_user_exists():
    from app.services import openproject_session_bridge as bridge

    create_response = MagicMock(status_code=422, text="Unprocessable")
    search_response = MagicMock(
        status_code=200,
        json=lambda: {"_embedded": {"elements": [{"id": 5}]}},
    )
    update_response = MagicMock(status_code=200, text="OK")

    with patch("app.services.openproject_session_bridge.httpx.post", return_value=create_response) as post, patch(
        "app.services.openproject_session_bridge.httpx.get", return_value=search_response
    ) as get, patch(
        "app.services.openproject_session_bridge.httpx.patch", return_value=update_response
    ) as patch_user:
        bridge._ensure_openproject_user(
            projects_url="https://projects.demo.desk.gentian.org",
            admin_user="api_admin",
            admin_password="secret",
            login="john-doe",
            display_name="John Doe",
            email="john-doe@demo.desk.gentian.org",
            password="portal-temp-password",
        )

    post.assert_called_once()
    get.assert_called_once()
    patch_user.assert_called_once()


def test_openproject_bridge_ticket_roundtrip():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    claims = {
        "preferred_username": "john-doe@demo.desk.gentian.org",
        "name": "John Doe",
    }
    with patch(
        "app.services.openproject_session_bridge.create_openproject_bridge_session",
        return_value={"username": "john-doe", "password": "portal-temp-password"},
    ):
        ticket = create_openproject_bridge_ticket(claims, tenant="demo", settings=settings)
    session = redeem_openproject_bridge_ticket(ticket, settings)
    assert session == {"username": "john-doe", "password": "portal-temp-password"}


def test_openproject_bridge_ticket_rejects_tampered_token():
    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    bad = jwt.encode({"u": "john-doe", "p": "pw"}, "wrong-secret", algorithm="HS256")
    with pytest.raises(Exception):
        redeem_openproject_bridge_ticket(bad, settings)
