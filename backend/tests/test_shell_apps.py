"""Tests for shell launcher app resolution."""

from app.core.shell_apps import shell_apps_for_user


def test_shell_apps_for_tenant_admin():
    settings = type("S", (), {"auth_disabled": False})()
    user = {
        "preferred_username": "admin-demo",
        "groups": ["gentian:tenant:demo:admins"],
    }
    apps = shell_apps_for_user(user, settings)
    assert len(apps) == 1
    assert apps[0]["id"] == "admin"


def test_shell_apps_for_member_empty():
    settings = type("S", (), {"auth_disabled": False})()
    user = {
        "preferred_username": "member-demo",
        "groups": ["gentian:tenant:demo:members"],
    }
    assert shell_apps_for_user(user, settings) == []
