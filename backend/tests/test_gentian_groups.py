"""Tests for Gentian group naming and bootstrap admin helpers."""

from app.core.gentian_groups import (
    is_platform_bootstrap_admin,
    user_is_platform_admin,
)


def test_platform_bootstrap_administrator_user():
    user = {"preferred_username": "administrator"}
    assert is_platform_bootstrap_admin(user)
    assert user_is_platform_admin(user)


def test_platform_bootstrap_administrator_email():
    user = {"email": "administrator@desk.gentian.org"}
    assert is_platform_bootstrap_admin(user)


def test_regular_user_is_not_platform_bootstrap_admin():
    user = {"preferred_username": "alice"}
    assert not is_platform_bootstrap_admin(user)
    assert not user_is_platform_admin(user)
