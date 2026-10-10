"""The cluster, as the director answers for it.

Every route here relays to the gentian-os director as the caller and hands
back whatever it answers, unchanged. The console holds no credential, keeps
no state, and decides nothing: whether this person may list tenants, change
a setting or open a console is the director's answer, read from the
authorization graph, and a refusal comes back as the refusal it is.
"""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/cluster", tags=["cluster"])
_bearer = HTTPBearer(auto_error=False)


def _cluster_path(settings: Settings, suffix: str) -> str:
    return f"/v1/clusters/{director.cluster(settings)}{suffix}"


@router.get("/me")
async def cluster_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Which of the cluster's verbs this person holds. Every verb false is an
    ordinary answer: it is what almost everyone who signs in gets."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/me"), bearer_of(credentials)
    )


@router.get("/settings")
async def cluster_settings(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """What this cluster is configured with, catalogue and values together, so
    the screen renders from one answer and holds no catalogue of its own."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/settings"), bearer_of(credentials)
    )


@router.patch("/settings")
async def set_cluster_settings(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """One request is one commit. 202 with a commit means git has it and the
    cluster does not yet; 200 means the state asked for already held."""
    return await director.forward(
        settings,
        "PATCH",
        _cluster_path(settings, "/settings"),
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/models")
async def cluster_models(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The models the Cluster claim declares for the gateway, and what the
    claim alone says about each: the director's answer, read from git. Neither
    the gateway nor the vault is asked, here or there."""
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/models"), bearer_of(credentials)
    )


@router.put("/models")
async def set_cluster_models(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The whole of the model settings, as one commit by the director. It
    holds the body to the claim's schema and refuses any field the settings
    have none of -- a provider's token among them, which is a credential and
    is entered on the credentials screen."""
    return await director.forward(
        settings,
        "PUT",
        _cluster_path(settings, "/models"),
        bearer_of(credentials),
        json_body=body,
    )


@router.get("/tenants")
async def cluster_tenants(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings, "GET", _cluster_path(settings, "/tenants"), bearer_of(credentials)
    )


@router.post("/tenants")
async def create_cluster_tenant(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, "/tenants"),
        bearer_of(credentials),
        json_body=body,
    )


@router.delete("/tenants/{tenant}")
async def retire_cluster_tenant(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings, "DELETE", _cluster_path(settings, f"/tenants/{tenant}"), bearer_of(credentials)
    )


@router.post("/tenants/{tenant}/purge")
async def purge_cluster_tenant(
    tenant: str,
    body: dict | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Retire a tenant and delete its data.

    The director commits deletionPolicy: Delete first and removes the tenant
    once the cluster holds it, so the answer is the first commit; the tenant
    is listed as purging until the second lands. keepBundles is the one
    option relayed: it spares the backup bucket.
    """
    payload = {"keepBundles": True} if body and body.get("keepBundles") else {}
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, f"/tenants/{tenant}/actions/purge"),
        bearer_of(credentials),
        json_body=payload,
    )


@router.post("/bundles")
async def upload_bundle(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A .gentian file, streamed through to the director as it arrives: a
    bundle can be gigabytes, and nothing here needs to see inside it."""
    return await director.forward_stream(
        settings,
        "POST",
        _cluster_path(settings, "/bundles"),
        bearer_of(credentials),
        request.stream(),
        request.headers.get("content-type", "application/x-tar"),
    )


@router.post("/tenants/import")
async def import_tenant(
    body: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Create plus Restore from a bundle. The director reads the manifest
    with the key given, declares the tenant from it and restores once the
    operator has provisioned the shells; the status route follows it."""
    payload = {k: body[k] for k in ("bundle", "decryption", "name") if k in body}
    return await director.forward(
        settings,
        "POST",
        _cluster_path(settings, "/tenants/import"),
        bearer_of(credentials),
        json_body=payload,
    )


@router.get("/tenants/{tenant}/import")
async def import_status(
    tenant: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    return await director.forward(
        settings,
        "GET",
        _cluster_path(settings, f"/tenants/{tenant}/import"),
        bearer_of(credentials),
    )


@router.post("/tenants/{tenant}/activate-admin")
async def activate_tenant_admin(
    tenant: str,
    body: dict | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Hand a tenant's administrator account to its holder.

    The account has no password. The registrar issues a single-use link that
    sets one (and a second factor unless the tenant opts out): mailed to the
    recovery address when one is given, otherwise returned to show once.
    """
    payload = {}
    if body and body.get("recoveryEmail"):
        payload["recoveryEmail"] = body["recoveryEmail"]
    return await director.forward_to(
        director.registrar_url(settings),
        "POST",
        _cluster_path(settings, f"/tenants/{tenant}/actions/activate-admin"),
        bearer_of(credentials),
        json_body=payload,
    )
