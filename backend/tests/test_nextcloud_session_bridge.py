"""Tests for Nextcloud portal bridge tickets."""

from unittest.mock import patch

import jwt

from app.core.config import Settings
from app.services.nextcloud_session_bridge import (
    _ocs_status,
    create_nextcloud_bridge_ticket,
    nextcloud_admin_url,
    nextcloud_uid_from_claims,
    redeem_nextcloud_bridge_ticket,
)
from xml.etree import ElementTree


def test_ocs_status_parses_unnamespaced_xml():
    root = ElementTree.fromstring(
        """<?xml version="1.0"?>
        <ocs>
          <meta>
            <status>ok</status>
            <statuscode>100</statuscode>
            <message>OK</message>
          </meta>
        </ocs>"""
    )
    assert _ocs_status(root) == ("ok", "100")


def test_nextcloud_admin_url_uses_in_cluster_service():
    assert (
        nextcloud_admin_url("demo", "desk.gentian.org")
        == "http://nextcloud.tenant-demo.svc.cluster.local:8080"
    )


def test_ensure_nextcloud_user_skips_password_reset_when_user_exists():
    from unittest.mock import MagicMock

    from app.services import nextcloud_session_bridge as bridge

    existing_user_xml = """<?xml version="1.0"?>
    <ocs><meta><status>failure</status><statuscode>102</statuscode>
    <message>User already exists</message></meta></ocs>"""

    create_response = MagicMock(status_code=200, text=existing_user_xml)

    with patch("app.services.nextcloud_session_bridge.httpx.post", return_value=create_response) as post, patch(
        "app.services.nextcloud_session_bridge.httpx.put"
    ) as put:
        bridge._ensure_nextcloud_user(
            cloud_url="http://nextcloud.tenant-demo.svc.cluster.local:8080",
            admin_user="admin",
            admin_password="secret",
            uid="john-doe",
            display_name="John Doe",
            password="portal-temp-password",
        )

    # The bridge never uses the account password, so an existing user must not
    # trigger a (slow) password reset — only the create/existence check runs.
    post.assert_called_once()
    put.assert_not_called()


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


def test_read_nextcloud_admin_credentials_dynamic_resolution():
    from app.services.nextcloud_session_bridge import _read_nextcloud_admin_credentials
    from unittest.mock import MagicMock

    mock_secret = MagicMock()
    mock_secret.data = {
        "internal-admin_password": "cGFzc3dvcmQ="
    }

    with (
        patch("app.services.k8s_catalogue.list_installed_profiles", return_value=["nextcloud-office"]),
        patch("app.services.nextcloud_session_bridge._core_v1_api") as mock_core,
    ):
        mock_api = mock_core.return_value
        mock_api.read_namespaced_secret.return_value = mock_secret

        _read_nextcloud_admin_credentials("demo")

        mock_api.read_namespaced_secret.assert_called_once_with("nextcloud-office-sensitive-values", "tenant-demo")
