from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_name: str = "Gentian Shell"
    api_v1_str: str = "/api/v1"
    environment: str = Field(default="local", alias="ENVIRONMENT")

    kernel_domain: str = Field(default="gentian.local", alias="KERNEL_DOMAIN")
    kernel_realm: str = Field(default="kernel", alias="KERNEL_REALM")
    tenancy_mode: str = Field(default="multi", alias="TENANCY_MODE")

    # Cluster capabilities present on THIS cluster, comma-separated (e.g. "llm").
    #
    # A platform app annotated gentianos.io/requires-capability gets a desktop
    # tile only when its capability appears here. Empty by default: a tile for a
    # component that is not deployed points at a host that resolves to nothing,
    # so the safe answer when nothing has told us is to show nothing.
    capabilities: str = Field(default="", alias="GENTIAN_CAPABILITIES")

    @property
    def capability_set(self) -> set[str]:
        return {c.strip() for c in self.capabilities.split(",") if c.strip()}

    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    portal_shell_secrets_namespace: str = Field(
        default="platform-kernel",
        alias="PORTAL_SHELL_SECRETS_NAMESPACE",
    )

    oidc_issuer: str | None = Field(default=None, alias="OIDC_ISSUER")
    oidc_client_id: str | None = Field(default=None, alias="OIDC_CLIENT_ID")
    oidc_client_secret: str | None = Field(default=None, alias="OIDC_CLIENT_SECRET")
    oidc_audience: str | None = Field(default=None, alias="OIDC_AUDIENCE")

    openfga_api_url: str | None = Field(default=None, alias="OPENFGA_API_URL")
    openfga_store_id: str | None = Field(default=None, alias="OPENFGA_STORE_ID")
    openfga_api_token: str | None = Field(default=None, alias="OPENFGA_API_TOKEN")
    openfga_authzen_enabled: bool = Field(default=False, alias="OPENFGA_AUTHZEN_ENABLED")

    keycloak_admin_url: str | None = Field(default=None, alias="KEYCLOAK_ADMIN_URL")
    keycloak_admin_username: str = Field(default="admin", alias="KEYCLOAK_ADMIN_USERNAME")
    keycloak_admin_password: str | None = Field(default=None, alias="KEYCLOAK_ADMIN_PASSWORD")

    portal_bff_client_id: str = Field(default="gentian-portal-bff", alias="PORTAL_BFF_CLIENT_ID")
    portal_bff_client_secret: str | None = Field(default=None, alias="PORTAL_BFF_CLIENT_SECRET")

    matrix_bridge_password: str | None = Field(default=None, alias="MATRIX_BRIDGE_PASSWORD")

    auth_disabled: bool = Field(default=False, alias="AUTH_DISABLED")

    cors_origins: str = Field(default="http://localhost:5173", alias="BACKEND_CORS_ORIGINS")

    @property
    def portal_client_id(self) -> str:
        return self.oidc_client_id or "gentian-portal"

    @property
    def portal_login_url(self) -> str:
        return f"https://portal.{self.kernel_domain}/login"

    @property
    def idp_public_base_url(self) -> str:
        """Browser-facing Keycloak base URL (scheme + host + /auth)."""
        return f"https://id.{self.kernel_domain}/auth"

    @property
    def idp_public_host(self) -> str:
        return f"id.{self.kernel_domain}"

    def public_issuer_for_realm(self, realm: str) -> str:
        """Browser-facing issuer for a realm.

        Distinct from realm_issuer() in keycloak_account, which prefers the
        in-cluster admin URL — correct for server-to-server calls and useless for a
        redirect the browser has to follow. Derived from oidc_issuer by swapping
        the realm segment, so the scheme, host and /auth prefix stay whatever this
        deployment actually serves rather than being reassembled from parts.
        """
        issuer = (self.oidc_issuer or "").rstrip("/")
        if not realm:
            return issuer
        if "/realms/" in issuer:
            return issuer[: issuer.index("/realms/")] + f"/realms/{realm}"
        return f"{self.idp_public_base_url.rstrip('/')}/realms/{realm}"

    @property
    def oidc_realm_base_url(self) -> str | None:
        """Realm OIDC base URL for JWKS/userinfo (prefer in-cluster Keycloak)."""
        issuer = (self.oidc_issuer or "").rstrip("/")
        if not issuer:
            return None
        if self.keycloak_admin_url and "/realms/" in issuer:
            realm_path = issuer[issuer.index("/realms/") :]
            return self.keycloak_admin_url.rstrip("/") + realm_path
        return issuer

    @property
    def oidc_jwks_url(self) -> str | None:
        base = self.oidc_realm_base_url
        return f"{base}/protocol/openid-connect/certs" if base else None

    @property
    def oidc_userinfo_url(self) -> str | None:
        base = self.oidc_realm_base_url
        return f"{base}/protocol/openid-connect/userinfo" if base else None

    @property
    def oidc_expected_client_id(self) -> str | None:
        return self.oidc_audience or self.oidc_client_id

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod", "staging"}

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.is_production and self.cors_origins.strip() == "*":
            raise ValueError("BACKEND_CORS_ORIGINS must not be '*' in production (M9)")
        if self.is_production and self.auth_disabled:
            raise ValueError("AUTH_DISABLED must be false in production (M2)")
        if self.is_production and not self.database_url and self.tenancy_mode.lower() != "multi":
            raise ValueError("DATABASE_URL or multi-tenant portal shell secrets are required in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
