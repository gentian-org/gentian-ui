"""Tests for notification audience validation and inbox matching."""

from app.services.admin_notifications import AdminNotification, NotificationAudience
from app.services.notification_audience import (
    notification_visible_to_user,
    normalize_audience,
    validate_publish_audience,
)


def test_normalize_audience_defaults_to_tenant_members():
    audience = normalize_audience(NotificationAudience(scope="tenant", tenant="demo"), "demo")
    assert audience.groups == ["gentian:tenant:demo:members"]


def test_platform_notification_visible_to_any_user():
    notification = AdminNotification(
        id="n1",
        published_at=1_700_000_000_000,
        title="Maintenance",
        body="Tonight",
        severity="info",
        audience=NotificationAudience(scope="platform"),
        publisher="admin",
        tenant="kernel",
    )
    user = {"groups": ["gentian:tenant:demo:members"]}
    assert notification_visible_to_user(notification, user, user_tenant="demo")


def test_tenant_notification_requires_group_membership():
    notification = AdminNotification(
        id="n2",
        published_at=1_700_000_000_000,
        title="Hello",
        body="Team",
        severity="info",
        audience=NotificationAudience(
            scope="tenant",
            tenant="demo",
            groups=["gentian:tenant:demo:admins"],
        ),
        publisher="admin",
        tenant="demo",
    )
    member = {"groups": ["gentian:tenant:demo:members"]}
    admin = {"groups": ["gentian:tenant:demo:admins"]}
    assert not notification_visible_to_user(notification, member, user_tenant="demo")
    assert notification_visible_to_user(notification, admin, user_tenant="demo")


def test_validate_publish_audience_allows_platform_superadmin():
    user = {"groups": ["gentian:platform:superadmin"]}
    audience = validate_publish_audience(
        user,
        resolved_tenant="kernel",
        kernel_realm="kernel",
        audience=NotificationAudience(scope="platform"),
    )
    assert audience.scope == "platform"


def test_cloudevent_envelope_shape():
    from app.services.notification_cloudevents import notification_to_cloudevent

    notification = AdminNotification(
        id="abc",
        published_at=1_700_000_000_000,
        title="Test",
        body="Body",
        severity="warning",
        audience=NotificationAudience(scope="tenant", tenant="demo", groups=["gentian:tenant:demo:members"]),
        publisher="admin@demo",
        tenant="demo",
    )
    event = notification_to_cloudevent(notification)
    assert event["specversion"] == "1.0"
    assert event["type"] == "gentian.admin.notification.published.v1"
    assert event["gentianaudience"]["tenant"] == "demo"
    assert event["data"]["title"] == "Test"
