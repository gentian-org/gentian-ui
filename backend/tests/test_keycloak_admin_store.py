"""Tests for Keycloak admin store helpers."""

from app.services.keycloak_admin_store import KeycloakAdminStore


def test_smtp_unavailable_detects_missing_sender():
    class Response:
        status_code = 500
        text = (
            '{"errorMessage":"Failed to send execute actions email: '
            'No sender address configured in the realm settings for emails"}'
        )

    assert KeycloakAdminStore._smtp_unavailable(Response()) is True


def test_smtp_unavailable_ignores_other_errors():
    class Response:
        status_code = 400
        text = '{"errorMessage":"User not found"}'

    assert KeycloakAdminStore._smtp_unavailable(Response()) is False
