"""CloudEvents 1.0 envelope for admin-notifications contract."""

from __future__ import annotations

from datetime import datetime, timezone

from app.services.admin_notifications import CLOUDEVENT_TYPE, AdminNotification


def notification_to_cloudevent(notification: AdminNotification) -> dict:
    published = datetime.fromtimestamp(notification.published_at / 1000, tz=timezone.utc)
    data = {
        "id": notification.id,
        "title": notification.title,
        "body": notification.body,
        "severity": notification.severity,
        "publisher": notification.publisher,
        "tenant": notification.tenant,
        "linkUrl": notification.link_url,
        "linkLabel": notification.link_label,
        "expiresAt": notification.expires_at,
    }
    return {
        "specversion": "1.0",
        "id": notification.id,
        "source": "/gentian/admin-notifications",
        "type": CLOUDEVENT_TYPE,
        "time": published.isoformat().replace("+00:00", "Z"),
        "datacontenttype": "application/json",
        "data": data,
        "gentianaudience": {
            "scope": notification.audience.scope,
            "tenant": notification.audience.tenant,
            "groups": notification.audience.groups,
        },
    }
