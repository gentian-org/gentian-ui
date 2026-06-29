"""Tests for SQL-backed admin audit persistence."""

import pytest

from app.core.config import get_settings
from app.db.engine import init_audit_database
from app.services.audit_events import AuditEventFilters
from app.services.sql_audit_store import SqlAuditStore


@pytest.mark.asyncio
async def test_sql_audit_store_persists_events():
    settings = get_settings()
    assert settings.database_url
    init_audit_database(settings.database_url)

    store = SqlAuditStore()
    await store.record(
        tenant="demo",
        category="admin_action",
        action="member.created",
        actor="administrator",
        target="alice@demo.desk.gentian.org",
        details={"memberId": "m-1"},
    )

    events = await store.list_events("demo", AuditEventFilters(action="member.created"))
    assert len(events) == 1
    assert events[0].actor == "administrator"
    assert events[0].target == "alice@demo.desk.gentian.org"

    other_tenant = await store.list_events("kernel", AuditEventFilters())
    assert other_tenant == []
