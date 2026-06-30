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


def test_execute_actions_email_degraded_on_missing_client():
    class Response:
        status_code = 400
        text = '{"errorMessage":"Client doesn\'t exist"}'

    assert KeycloakAdminStore._execute_actions_email_degraded(Response()) is True


def test_smtp_unavailable_covers_send_failures():
    class Response:
        status_code = 500
        text = '{"errorMessage":"Failed to send execute actions email: connection refused"}'

    assert KeycloakAdminStore._smtp_unavailable(Response()) is True


def test_public_frontend_headers():
    store = KeycloakAdminStore(
        base_url="http://keycloak.internal:8080/auth",
        username="admin",
        password="secret",
        idp_public_host="id.desk.gentian.org",
    )
    assert store._public_frontend_headers() == {
        "X-Forwarded-Host": "id.desk.gentian.org",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Port": "443",
    }


def test_session_from_raw_maps_keycloak_fields():
    session = KeycloakAdminStore._session_from_raw(
        "user-1",
        {
            "id": "sess-abc",
            "ipAddress": "203.0.113.10",
            "start": 1_700_000_000,
            "lastAccess": 1_700_000_500,
            "clients": {"client-uuid": "gentian-portal"},
        },
    )
    assert session.id == "sess-abc"
    assert session.member_id == "user-1"
    assert session.client_name == "gentian-portal"
    assert session.ip_address == "203.0.113.10"
    assert session.started_at == 1_700_000_000
    assert session.last_access_at == 1_700_000_500
