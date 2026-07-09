import urllib.parse
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
import httpx

from app.core.config import Settings, get_settings
from app.services.k8s_catalogue import _custom_objects_api, GROUP, VERSION

router = APIRouter()


def resolve_api_profile_by_subdomain(subdomain: str) -> dict | None:
    """Scan cluster AppProfiles to find the ApiProfile managing the given subdomain."""
    try:
        api = _custom_objects_api()
        profiles = api.list_cluster_custom_object(GROUP, VERSION, "appprofiles")
        for p in profiles.get("items", []):
            spec = p.get("spec", {})
            if spec.get("deploymentMethod") != "api":
                continue
            ing = spec.get("ingress") or {}
            if ing.get("subDomain") == subdomain:
                return p
            for ai in spec.get("additionalIngresses", []):
                if ai.get("subDomain") == subdomain:
                    return p
    except Exception:
        pass
    return None


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def reverse_proxy(
    request: Request,
    path: str,
    settings: Settings = Depends(get_settings),
):
    host_header = request.headers.get("host") or ""
    hostname = host_header.split(":")[0]
    parts = hostname.split(".")
    
    # We expect sub_domain.tenant_id.kernel_domain
    if len(parts) < 3:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hostname format invalid")

    subdomain = parts[0]
    tenant = parts[1]

    profile = resolve_api_profile_by_subdomain(subdomain)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ApiProfile not found for subdomain: {subdomain}",
        )

    spec = profile.get("spec", {})
    api = spec.get("apiIntegration") or {}
    base_url = str(api.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ApiProfile integration BaseURL not configured",
        )

    # Reconstruct destination URL paths and query strings
    path_suffix = f"/{path}" if path else "/"
    query_string = request.url.query

    if str(api.get("tenantBinding") or "tenant-domain") == "tenant-domain":
        kernel_domain = ".".join(parts[2:])
        tenant_domain = f"{tenant}.{kernel_domain}"
        binding_param = f"tenantDomain={tenant_domain}"
        if query_string:
            query_string += f"&{binding_param}"
        else:
            query_string = binding_param

    target_url = f"{base_url}{path_suffix}"
    if query_string:
        target_url += f"?{query_string}"

    # Forward headers and rewrite host header to destination target
    headers = dict(request.headers)
    target_parsed = urllib.parse.urlparse(base_url)
    headers["host"] = target_parsed.netloc
    headers.pop("content-length", None)

    body = await request.body()
    client = httpx.AsyncClient()
    try:
        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
        )
        resp = await client.send(req, stream=True)

        resp_headers = dict(resp.headers)
        resp_headers.pop("transfer-encoding", None)
        resp_headers.pop("content-length", None)

        async def generate():
            async for chunk in resp.aiter_bytes():
                yield chunk
            await resp.aclose()
            await client.aclose()

        return StreamingResponse(
            generate(),
            status_code=resp.status_code,
            headers=resp_headers,
        )
    except Exception as e:
        await client.aclose()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"ApiProfile reverse-proxy error: {str(e)}",
        )
