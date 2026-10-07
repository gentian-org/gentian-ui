# SPDX-License-Identifier: Apache-2.0
import re
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.1.0"

# A public host name: labels of letters, digits and hyphens, at least two of
# them. No port, no path, no upper case -- the redirect address a store's
# issuer accepts is spelled from this, character for character.
_HOST = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$")

# The host label of this component. The store's issuer computes the one
# redirect address it accepts as https://store.<host of tenant_url>/oauth/callback,
# so the tenant's address is this app's host without that label.
HOST_LABEL = "store"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_name: str = "Gentian App Store"
    api_v1_str: str = "/api/v1"
    environment: str = Field(default="local", alias="ENVIRONMENT")

    tenant_id: str = Field(default="demo", alias="TENANT_ID")

    oidc_issuer: str | None = Field(default=None, alias="OIDC_ISSUER")
    oidc_client_id: str | None = Field(default=None, alias="OIDC_CLIENT_ID")
    # The audience a bearer must carry. Under edge this is the director's,
    # because the zone's token is minted for the director; requiring it is
    # what stops a token the realm signed for some other purpose from being
    # taken for the zone's session. Falls back to the client id.
    oidc_audience: str | None = Field(default=None, alias="OIDC_AUDIENCE")

    # pkce: the bundle ran the code flow and sends its own token. edge: the
    # platform's Gateway holds the session and forwards the zone's token, and
    # this API relays it to the cluster's services when it needs an answer
    # about the caller. The platform sets this; a component does not choose it.
    auth_mode: str = Field(default="pkce", alias="AUTH_MODE")

    # Facts of the cluster this component runs in, set by the platform from
    # the profile's valueMapping.platform. None is chosen here.
    kernel_domain: str | None = Field(default=None, alias="KERNEL_DOMAIN")
    kernel_realm: str | None = Field(default=None, alias="KERNEL_REALM")
    zone_kind: str | None = Field(default=None, alias="ZONE_KIND")

    # Where the cluster's services answer. Each is asked with the caller's own
    # token and nothing else. Unset leaves the routes that need it answering
    # 503 and naming the setting, rather than guessing a host.
    director_url: str | None = Field(default=None, alias="DIRECTOR_URL")
    cluster_id: str | None = Field(default=None, alias="GENTIAN_CLUSTER_ID")
    custodian_url: str | None = Field(default=None, alias="CUSTODIAN_URL")
    usher_url: str | None = Field(default=None, alias="USHER_URL")

    # The store API's base address: what the Cluster claim names as
    # catalogue.storeUrl. https, no trailing slash, no path beyond a prefix.
    # Unset means this cluster names no store, and the app says so.
    store_url: str | None = Field(default=None, alias="STORE_URL")

    # This app's own public host, store.<the tenant's base domain>. The
    # sign-in at a store's issuer is spelled from it: the redirect address is
    # https://<host>/oauth/callback and the tenant's address is the host
    # without its first label. Never taken from a request.
    app_host: str | None = Field(default=None, alias="APP_HOST")

    auth_disabled: bool = Field(default=False, alias="AUTH_DISABLED")

    # Origins, besides this API's own, whose pages may send it state-changing
    # requests (app/core/origin_check.py). Comma-separated, scheme://host[:port].
    # Empty by default: behind the edge the bundle and the API share one
    # origin and nothing else has any business here. Local development with
    # the Vite proxy names http://localhost:5173, because the proxy rewrites
    # Host to the API's own.
    csrf_trusted_origins: str = Field(default="", alias="CSRF_TRUSTED_ORIGINS")

    @property
    def csrf_trusted_origin_list(self) -> list[str]:
        return [o.strip() for o in self.csrf_trusted_origins.split(",") if o.strip()]

    @property
    def is_edge(self) -> bool:
        return self.auth_mode == "edge"

    @property
    def expected_audience(self) -> str | None:
        """What a bearer must be for: the configured audience, else the client."""
        return self.oidc_audience or self.oidc_client_id

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod", "staging"}

    @property
    def store_base(self) -> str | None:
        """The store API's base, or None when the cluster names no store."""
        value = (self.store_url or "").strip().rstrip("/")
        return value or None

    @property
    def host(self) -> str | None:
        """This app's host when it is one a sign-in can be spelled from."""
        value = (self.app_host or "").strip()
        if not _HOST.match(value) or not value.startswith(HOST_LABEL + "."):
            return None
        return value

    @property
    def redirect_uri(self) -> str | None:
        """The one address a store's issuer redirects to for this tenant."""
        return f"https://{self.host}/oauth/callback" if self.host else None

    @property
    def tenant_url(self) -> str | None:
        """The tenant's address as the licence report spells it: https://<host>,
        lower case, no path and no trailing slash."""
        if not self.host:
            return None
        return "https://" + self.host[len(HOST_LABEL) + 1 :]

    @property
    def admin_console_url(self) -> str | None:
        """Where the tenant's administration console answers, beside this app."""
        if not self.host:
            return None
        return "https://admin." + self.host[len(HOST_LABEL) + 1 :] + "/"

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.is_production and self.auth_disabled:
            raise ValueError("AUTH_DISABLED must be false in production (M2)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
