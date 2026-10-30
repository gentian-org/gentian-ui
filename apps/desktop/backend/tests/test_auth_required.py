import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_without_an_issuer_it_does_not_start():
    with pytest.raises(ValidationError, match="OIDC_ISSUER is required"):
        Settings(_env_file=None, AUTH_DISABLED="false", OIDC_ISSUER="")


def test_auth_disabled_needs_no_issuer():
    settings = Settings(_env_file=None, AUTH_DISABLED="true", OIDC_ISSUER="")
    assert settings.auth_disabled


def test_production_is_the_default(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    settings = Settings(_env_file=None, AUTH_DISABLED="false", OIDC_ISSUER="https://issuer.example")
    assert settings.is_production


def test_the_anonymous_path_needs_the_local_opt_out(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(ValidationError, match="AUTH_DISABLED must be false"):
        Settings(_env_file=None, AUTH_DISABLED="true", OIDC_ISSUER="")
    monkeypatch.setenv("ENVIRONMENT", "local")
    assert Settings(_env_file=None, AUTH_DISABLED="true", OIDC_ISSUER="").auth_disabled
