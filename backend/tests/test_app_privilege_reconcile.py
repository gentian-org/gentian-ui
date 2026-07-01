"""Tests for app-admins privilege reconcile triggers."""

from app.core.gentian_groups import tenant_app_admins_group


class _Group:
    def __init__(self, group_id: str, name: str) -> None:
        self.id = group_id
        self.name = name


def test_app_admins_membership_changed_detects_add():
    from app.api.routes.admin import _app_admins_membership_changed

    tenant = "demo"
    groups = [_Group("1", tenant_app_admins_group(tenant))]
    assert _app_admins_membership_changed(groups, set(), ["1"], tenant)


def test_app_admins_membership_changed_ignores_entitlement_only():
    from app.api.routes.admin import _app_admins_membership_changed

    tenant = "demo"
    groups = [_Group("1", f"gentian:tenant:{tenant}:app:nextcloud")]
    assert not _app_admins_membership_changed(groups, set(), ["1"], tenant)
