"""Unauthenticated auth helpers for the portal login page."""

import re

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.login_routing import resolve_login_route
from app.services.admin_store import AdminStoreDep, admin_store_configured
from app.services.credential_manager import prove_write_path
from app.services.keycloak_user_groups import realm_from_issuer

router = APIRouter(prefix="/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)

# Keycloak realm names, which are also the DNS label the tenant is reached on.
_TENANT_RE = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get("/login-route")
def login_route(
    email: str = Query(..., min_length=3, max_length=320),
    settings: Settings = Depends(get_settings),
) -> dict[str, str | None]:
    """Resolve email → tenant realm for Gentian login."""
    try:
        route = resolve_login_route(
            email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    # Which realm the browser is sent to depends on the email, which is why the
    # portal asks for it before redirecting. Tenant members authenticate in their
    # own realm — that is where their account and every per-app OIDC client live,
    # so that is where the SSO session has to be created for app launches to reuse
    # it. Platform operators authenticate in the kernel realm.
    realm = settings.kernel_realm if route.idp_hint is None else route.idp_hint
    return {
        "loginHint": route.login_hint,
        "idpHint": route.idp_hint,
        "kind": route.kind,
        "realm": realm,
        "issuer": settings.public_issuer_for_realm(realm),
        # Where a tenant member's sign-in must actually happen, not merely start.
        #
        # The portal is served on this tenant's own host now (see gentian-os
        # kernelHTTPRouteSpecs), and that host is what is registered on the
        # Keycloak client as a redirect_uri. Completing the flow on the apex and
        # only linking to the tenant host afterwards does not canonicalise
        # anything: redirect_uri is derived from window.location.origin at the
        # moment loginRedirect() runs, so the flow has to start there too.
        "tenantHost": (
            f"{route.idp_hint}.{settings.kernel_domain}" if route.idp_hint else None
        ),
    }


@router.get("/entry")
def entry(request: Request, settings: Settings = Depends(get_settings)) -> dict[str, str | None]:
    """Which realm this hostname signs people in to.

    The portal answers on the shared portal host and on every tenant's own host.
    On a tenant host the realm is already decided and there is nothing to ask, so
    the login page skips straight to it.

    Derived from the Host header rather than parsed in the browser, which would
    have to know how many labels the kernel domain has and which first labels are
    not tenants.
    """
    host = (request.headers.get("host") or "").split(":")[0].lower()
    suffix = f".{settings.kernel_domain}".lower()
    tenant: str | None = None
    if host.endswith(suffix):
        label = host[: -len(suffix)]
        # A single label that is not the portal's own host. Anything deeper is an
        # app hostname (erp.demo.…), not a portal entry.
        if label and "." not in label and label != "portal" and _TENANT_RE.fullmatch(label):
            tenant = label
    return {
        "tenant": tenant,
        "realm": tenant or settings.kernel_realm,
        "issuer": settings.public_issuer_for_realm(tenant or settings.kernel_realm),
    }


@router.post("/session-started", status_code=status.HTTP_204_NO_CONTENT)
async def session_started(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    *,
    store: AdminStoreDep,
) -> None:
    """Best-effort housekeeping fired once, right after a real Keycloak login.

    The code exchange happens entirely browser-to-Keycloak now (see
    frontend/src/auth/oidc.ts, handleOAuthCallback), so this is the only moment
    the backend still sees "a login just happened" — the equivalent of what used
    to run inline in the old password-grant /auth/login handler.
    """
    # Prove the cluster's human write path, before anything else here can
    # return early.
    #
    # Signing in demonstrates Keycloak works, which was never in doubt. What
    # nothing else demonstrates is the EXCHANGE: trading this token for a
    # short-lived OpenBao one, which is what every credential write uses and
    # what the installer's bootstrap credential is traded away for. Until this
    # call was added the only thing that performed it was the Credentials tab,
    # so a cluster's proof depended on an administrator happening to navigate
    # there — and the install's last step refused, correctly, until they did.
    #
    # Best effort, and deliberately not fatal: a cluster whose OpenBao is
    # unreachable should still let its administrator in. The proof is recorded
    # by the credential manager when the exchange succeeds, so a failure here
    # simply means it is recorded on the next attempt.
    if credentials is not None and credentials.credentials:
        await prove_write_path(credentials.credentials, settings)

    if not admin_store_configured(settings):
        return
    realm = realm_from_issuer(str(user.get("iss") or ""))
    username = user.get("preferred_username")
    if not realm or not username:
        return
    try:
        await store.restore_workspace_email_for_login(realm, username)
    except Exception:
        pass


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(
    body: ForgotPasswordRequest,
    settings: Settings = Depends(get_settings),
    *,
    store: AdminStoreDep,
) -> None:
    """Send a password-reset email when the account exists (always 204)."""
    if settings.auth_disabled:
        return
    if not admin_store_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset is not configured on this cluster",
        )
    try:
        route = resolve_login_route(
            body.email,
            kernel_domain=settings.kernel_domain,
            tenancy_mode=settings.tenancy_mode,
        )
    except ValueError:
        return
    realm = settings.kernel_realm if route.idp_hint is None else route.idp_hint
    try:
        await store.send_password_reset_by_email(realm, body.email)
    except Exception:
        return


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    """Terminate the Keycloak SSO session of the current user via the Admin API."""
    if settings.auth_disabled:
        return

    user_id = user.get("sub")
    issuer = user.get("iss")
    if not user_id or not issuer:
        return

    realm = realm_from_issuer(issuer)
    if not realm:
        return

    from app.services.keycloak_user_groups import _fetch_admin_token
    try:
        admin_token = _fetch_admin_token(settings)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the identity service",
        ) from exc

    if not admin_token:
        return

    import httpx
    base = settings.keycloak_admin_url.rstrip("/")
    url = f"{base}/admin/realms/{realm}/users/{user_id}/logout"
    headers = {"Authorization": f"Bearer {admin_token}"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, timeout=15.0)
            response.raise_for_status()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to terminate identity session",
        ) from exc

