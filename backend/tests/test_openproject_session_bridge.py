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


def test_openproject_login_from_claims_falls_back_to_preferred_username():
    """No gentian_username: the login is the local part of preferred_username.

    The openDesk profiles issue opendesk_username from the LDAP uid and no
    neutral claim. That fallback used to sit ahead of preferred_username here;
    Keycloak's username is the same uid for LDAP-federated users, so
    preferred_username carries it.
    """
    assert (
        openproject_login_from_claims(
            {"preferred_username": "john-doe@demo.desk.gentian.org"}
        )
        == "john-doe"
    )


def test_openproject_portal_login_ok_accepts_422_with_session_cookie():
    from app.services.openproject_session_bridge import _openproject_portal_login_ok

    login_response = MagicMock(
        status_code=422,
        headers={"set-cookie": "_open_project_session=abc; path=/; secure; HttpOnly"},
    )
    with patch("app.services.openproject_session_bridge.httpx.post", return_value=login_response):
        assert _openproject_portal_login_ok("https://projects.demo.desk.gentian.org", "john-doe", "pw")


def test_ensure_openproject_user_skips_patch_when_login_already_works():
    from app.services import openproject_session_bridge as bridge

    search_response = MagicMock(
        status_code=200,
        json=lambda: {"_embedded": {"elements": [{"id": 5}]}},
    )
    login_response = MagicMock(
        status_code=422,
        headers={"set-cookie": "_open_project_session=abc; path=/"},
    )

    with patch("app.services.openproject_session_bridge.httpx.post", return_value=login_response) as post, patch(
        "app.services.openproject_session_bridge.httpx.get", return_value=search_response
    ) as get, patch("app.services.openproject_session_bridge.httpx.patch") as patch_user:
        bridge._ensure_openproject_user(
            projects_url="https://projects.demo.desk.gentian.org",
            admin_user="api_admin",
            admin_password="secret",
            login="john-doe",
            display_name="John Doe",
            email="john-doe@demo.desk.gentian.org",
            password="portal-stable-password",
        )

    post.assert_called_once()
    get.assert_called_once()
    patch_user.assert_not_called()


def test_ensure_openproject_user_patches_when_login_fails():
    from app.services import openproject_session_bridge as bridge

    search_response = MagicMock(
        status_code=200,
        json=lambda: {"_embedded": {"elements": [{"id": 5}]}},
    )
    login_response = MagicMock(status_code=401, headers={})
    update_response = MagicMock(status_code=200, text="OK")

    with patch(
        "app.services.openproject_session_bridge.httpx.post",
        return_value=login_response,
    ) as post, patch(
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
            password="portal-stable-password",
        )

    post.assert_called_once()
    get.assert_called_once()
    patch_user.assert_called_once()


def test_ensure_openproject_user_creates_when_user_missing():
    from app.services import openproject_session_bridge as bridge

    search_response = MagicMock(status_code=200, json=lambda: {"_embedded": {"elements": []}})
    create_response = MagicMock(status_code=201, text="Created")

    with patch(
        "app.services.openproject_session_bridge.httpx.post", return_value=create_response
    ) as post, patch(
        "app.services.openproject_session_bridge.httpx.get", return_value=search_response
    ) as get, patch("app.services.openproject_session_bridge.httpx.patch") as patch_user:
        bridge._ensure_openproject_user(
            projects_url="https://projects.demo.desk.gentian.org",
            admin_user="api_admin",
            admin_password="secret",
            login="john-doe",
            display_name="John Doe",
            email="john-doe@demo.desk.gentian.org",
            password="portal-stable-password",
        )

    post.assert_called_once()
    get.assert_called_once()
    patch_user.assert_not_called()


def test_stable_portal_password_is_deterministic():
    from app.services.openproject_session_bridge import _stable_portal_password

    settings = Settings(PORTAL_BFF_CLIENT_SECRET="secret")
    first = _stable_portal_password("john-doe", "demo", settings)
    second = _stable_portal_password("john-doe", "demo", settings)
    other = _stable_portal_password("jane-doe", "demo", settings)
    assert first == second
    assert first != other
    assert len(first) == 32


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
