"""Tests for notification audience validation and inbox matching."""

from app.services.admin_notifications import AdminNotification, NotificationAudience
from app.services.notification_audience import (
    notification_visible_to_user,
    normalize_audience,
)


def test_normalize_audience_defaults_to_every_person_of_the_tenant():
    audience = normalize_audience(NotificationAudience(scope="tenant", tenant="demo"), "demo")
    assert audience.positions == ["user"]


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
    user = {"positions": ["user"]}
    assert notification_visible_to_user(notification, user, user_tenant="demo")


def test_tenant_notification_requires_the_position():
    notification = AdminNotification(
        id="n2",
        published_at=1_700_000_000_000,
        title="Hello",
        body="Team",
        severity="info",
        audience=NotificationAudience(
            scope="tenant",
            tenant="demo",
            positions=["tenant-administrator"],
        ),
        publisher="admin",
        tenant="demo",
    )
    member = {"positions": ["user"]}
    admin = {"positions": ["tenant-administrator", "user"]}
    assert not notification_visible_to_user(notification, member, user_tenant="demo")
    assert notification_visible_to_user(notification, admin, user_tenant="demo")


def test_cloudevent_envelope_shape():
    from app.services.notification_cloudevents import notification_to_cloudevent

    notification = AdminNotification(
        id="abc",
        published_at=1_700_000_000_000,
        title="Test",
        body="Body",
        severity="warning",
        audience=NotificationAudience(scope="tenant", tenant="demo", positions=["user"]),
        publisher="admin@demo",
        tenant="demo",
    )
    event = notification_to_cloudevent(notification)
    assert event["specversion"] == "1.0"
    assert event["type"] == "gentian.admin.notification.published.v1"
    assert event["gentianaudience"]["tenant"] == "demo"
    assert event["gentianaudience"]["positions"] == ["user"]
    assert event["data"]["title"] == "Test"


def _notice(audience: NotificationAudience) -> AdminNotification:
    return AdminNotification(
        id="n3",
        published_at=1_700_000_000_000,
        title="Your export is ready",
        body="Fetch it within a week.",
        severity="info",
        audience=audience,
        publisher="Exports",
        tenant="demo",
    )


MEMBER = {
    "sub": "8f1c",
    "preferred_username": "Ada",
    "email": "Ada@Example.org",
    "positions": ["user"],
}
OTHER_MEMBER = {
    "sub": "77aa",
    "preferred_username": "grace",
    "email": "grace@example.org",
    "positions": ["user"],
}


def test_notice_for_named_people_is_not_for_the_whole_tenant():
    # No group named used to mean every member. With people named it means
    # those people and nobody else.
    notice = _notice(NotificationAudience(scope="tenant", tenant="demo", people=["ada@example.org"]))
    assert notification_visible_to_user(notice, MEMBER, user_tenant="demo")
    assert not notification_visible_to_user(notice, OTHER_MEMBER, user_tenant="demo")


def test_person_is_named_by_subject_username_or_email():
    for entry in ("8f1c", "ada", "ADA@example.ORG"):
        notice = _notice(NotificationAudience(scope="tenant", tenant="demo", people=[entry]))
        assert notification_visible_to_user(notice, MEMBER, user_tenant="demo"), entry
        assert not notification_visible_to_user(notice, OTHER_MEMBER, user_tenant="demo"), entry
    # The subject is compared as it is.
    notice = _notice(NotificationAudience(scope="tenant", tenant="demo", people=["8F1C"]))
    assert not notification_visible_to_user(notice, MEMBER, user_tenant="demo")


def test_empty_claims_and_empty_entries_match_nobody():
    notice = _notice(NotificationAudience(scope="tenant", tenant="demo", people=["", "  "]))
    for user in (
        {"positions": ["user"]},
        {"sub": "", "preferred_username": "", "email": "", "positions": ["user"]},
        {"sub": None, "email": None, "positions": ["user"]},
    ):
        assert not notification_visible_to_user(notice, user, user_tenant="demo")


def test_people_and_positions_together_reach_both():
    notice = _notice(
        NotificationAudience(
            scope="tenant",
            tenant="demo",
            positions=["tenant-administrator"],
            people=["grace"],
        )
    )
    admin = {"sub": "a1", "positions": ["tenant-administrator", "user"]}
    assert notification_visible_to_user(notice, admin, user_tenant="demo")
    assert notification_visible_to_user(notice, OTHER_MEMBER, user_tenant="demo")
    assert not notification_visible_to_user(notice, MEMBER, user_tenant="demo")


def test_audience_without_people_or_positions_is_every_person_of_the_tenant():
    notice = _notice(NotificationAudience(scope="tenant", tenant="demo"))
    assert notification_visible_to_user(notice, MEMBER, user_tenant="demo")
    # Whoever the usher said nothing about is not shown it.
    assert not notification_visible_to_user(notice, {"sub": "x"}, user_tenant="demo")


def test_named_person_of_another_tenant_sees_nothing():
    notice = _notice(NotificationAudience(scope="tenant", tenant="demo", people=["ada"]))
    assert not notification_visible_to_user(notice, MEMBER, user_tenant="other")


def test_normalize_audience_keeps_people_and_adds_no_position_to_them():
    audience = normalize_audience(
        NotificationAudience(scope="tenant", tenant="demo", people=["ada"]), "demo"
    )
    assert audience.people == ["ada"]
    assert audience.positions == []


def test_row_written_before_people_reads_as_naming_nobody():
    from app.models.admin_notification import AdminNotificationRow
    from app.services.sql_notification_store import _row_to_notification

    row = AdminNotificationRow(
        id="old",
        published_at=1,
        tenant="demo",
        title="t",
        body="b",
        severity="info",
        publisher="admin",
        audience={"scope": "tenant", "tenant": "demo", "groups": []},
    )
    notification = _row_to_notification(row)
    assert notification.audience.people == []
    assert notification_visible_to_user(notification, MEMBER, user_tenant="demo")


def test_row_that_names_groups_and_nothing_else_is_for_nobody():
    """A notice written for a group must not widen to the whole tenant now
    that groups are not read."""
    from app.models.admin_notification import AdminNotificationRow
    from app.services.sql_notification_store import _row_to_notification

    row = AdminNotificationRow(
        id="old",
        published_at=1,
        tenant="demo",
        title="t",
        body="b",
        severity="info",
        publisher="admin",
        audience={"scope": "tenant", "tenant": "demo", "groups": ["gentian:tenant:demo:admins"]},
    )
    notification = _row_to_notification(row)
    admin = {"sub": "a1", "positions": ["tenant-administrator", "user"], "groups": ["gentian:tenant:demo:admins"]}
    assert not notification_visible_to_user(notification, admin, user_tenant="demo")
    assert not notification_visible_to_user(notification, MEMBER, user_tenant="demo")
    # Named people are still reached.
    row.audience = {"scope": "tenant", "tenant": "demo", "groups": ["g"], "people": ["ada"]}
    assert notification_visible_to_user(_row_to_notification(row), MEMBER, user_tenant="demo")
