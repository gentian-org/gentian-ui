from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
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

    # The tenant's own language, ISO 639-1 (AD-15). What a person sees before
    # they have chosen one and before a settings template has chosen for them,
    # so a German tenant's people get a German desktop on their first sign-in
    # rather than whatever their browser asks for.
    #
    # Set by the operator from the tenant's first declared language, so it
    # follows the tenant rather than the image.
    default_language: str = Field(default="", alias="GENTIAN_DEFAULT_LANGUAGE")

    @property
    def capability_set(self) -> set[str]:
        return {c.strip() for c in self.capabilities.split(",") if c.strip()}

    # The director, on the cluster network. Asked one thing: what the caller
    # holds on this desktop's tenant (`/v1/tenants/{t}/me`), with the caller's
    # own token.
    director_url: str | None = Field(default=None, alias="DIRECTOR_URL")
    # The usher, on the cluster network: the read-only service that answers
    # which tiles this person may open on this tenant's desktop. It holds no
    # authority; the tenant's own people are answered there, where the
    # director answers only those who hold a relation on the cluster.
    usher_url: str | None = Field(default=None, alias="USHER_URL")

    # The model gateway, for the assistant on the desktop (docs/ai-widget.md).
    #
    # The platform hands each tenant's desktop a key of its own at the gateway
    # and says so: LLM_AVAILABLE is true only when it delivered one. The
    # address is the gateway's OpenAI-compatible base (it ends in /v1). The
    # key is read from the file the chart mounts the platform's Secret at, on
    # every request, so a key the platform replaces is picked up without a
    # restart; LLM_API_KEY is for running outside a cluster. Neither is ever
    # logged or sent to the browser. With any of the three missing the
    # assistant answers 503 and the rest of the desktop is unaffected.
    llm_available: bool = Field(default=False, alias="LLM_AVAILABLE")
    llm_base_url: str | None = Field(default=None, alias="LLM_BASE_URL")
    llm_api_key_file: str | None = Field(default=None, alias="LLM_API_KEY_FILE")
    llm_api_key: SecretStr | None = Field(default=None, alias="LLM_API_KEY")
    # What one request to the assistant may cost, decided here and not by the
    # browser: the size of the request body, how many messages it carries,
    # and the most tokens an answer may run to.
    llm_max_request_bytes: int = Field(default=65536, alias="LLM_MAX_REQUEST_BYTES")
    llm_max_messages: int = Field(default=40, alias="LLM_MAX_MESSAGES")
    llm_max_tokens: int = Field(default=1024, alias="LLM_MAX_TOKENS")

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

    # Keycloak's in-cluster base URL, NOT an administrator credential.
    #
    # It is used to reach the realm's public endpoints -- JWKS, and the account
    # API with the caller's own token -- over the cluster network rather than
    # out through the gateway and back. The name predates the split and is now
    # misleading; it is spelled this way because gentian-os sets it, and
    # renaming it is a change on both sides.
    #
    # KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD are gone. They were a
    # Keycloak administrator credential, read by four services that could list
    # and write every account in the realm: the bundled administration console,
    # its audit fetcher, its security-policy store, and a group lookup on the
    # sign-in path. Nothing supplied them on v5, so the credential was latent
    # rather than live -- and latent is not the same as absent. The director
    # holds one per realm now, and every write through it is checked against
    # OpenFGA with the caller's own token (gentian-os S7A.6 and S7A.17).
    keycloak_admin_url: str | None = Field(default=None, alias="KEYCLOAK_ADMIN_URL")

    portal_bff_client_id: str = Field(default="gentian-portal-bff", alias="PORTAL_BFF_CLIENT_ID")
    portal_bff_client_secret: str | None = Field(default=None, alias="PORTAL_BFF_CLIENT_SECRET")

    matrix_bridge_password: str | None = Field(default=None, alias="MATRIX_BRIDGE_PASSWORD")

    auth_disabled: bool = Field(default=False, alias="AUTH_DISABLED")
    # pkce: the bundle runs the code flow and sends its own bearer. edge: the
    # Gateway holds the session and forwards the zone client's token (AD-13);
    # what the caller may do comes from the director, never from groups
    # this process reads off the token or looks up itself.
    auth_mode: str = Field(default="pkce", alias="AUTH_MODE")
    # The tenant this desktop is the desktop of (a component of it). Behind
    # the edge every relation is asked on this tenant.
    gentian_tenant: str | None = Field(default=None, alias="GENTIAN_TENANT")

    cors_origins: str = Field(default="http://localhost:5173", alias="BACKEND_CORS_ORIGINS")

    @property
    def edge_session(self) -> bool:
        return self.auth_mode == "edge"

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
