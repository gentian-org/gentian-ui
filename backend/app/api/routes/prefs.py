from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import Response

from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.core.tenant import resolve_user_context
from app.services.shell_prefs_store import (
    ALLOWED_BACKGROUND_MIMES,
    clear_background,
    get_background,
    get_summary,
    set_background,
)

router = APIRouter(prefix="/prefs", tags=["prefs"])


@router.get("/")
def get_prefs(user: dict = Depends(get_current_user), settings: Settings = Depends(get_settings)) -> dict:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    summary = get_summary(user_sub, tenant)
    return {
        "base": None,
        "theme": None,
        "hasBackground": summary.has_background,
        "backgroundUrl": f"{settings.api_v1_str}/prefs/background" if summary.has_background else None,
        "customPrefs": summary.prefs_json,
    }


@router.put("/", status_code=status.HTTP_204_NO_CONTENT)
def update_custom_prefs(
    data: dict,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    from app.db.tenant_engine import get_tenant_db_session
    from app.models.user_shell_prefs import UserShellPrefsRow
    with get_tenant_db_session(tenant) as session:
        row = session.get(UserShellPrefsRow, {"user_sub": user_sub, "tenant": tenant})
        if row is None:
            row = UserShellPrefsRow(user_sub=user_sub, tenant=tenant)
            session.add(row)
        row.prefs_json = data



@router.get("/background")
def get_prefs_background(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    stored = get_background(user_sub, tenant)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No custom background")
    data, mime = stored
    return Response(
        content=data,
        media_type=mime,
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.put("/background", status_code=status.HTTP_204_NO_CONTENT)
async def upload_prefs_background(
    file: UploadFile,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    mime = (file.content_type or "").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_BACKGROUND_MIMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a JPEG, PNG, WebP, or GIF image",
        )
    data = await file.read()
    try:
        set_background(user_sub, tenant, data, mime)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/background", status_code=status.HTTP_204_NO_CONTENT)
def delete_prefs_background(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    tenant = resolve_user_context(user, settings)
    user_sub = str(user.get("sub") or "anonymous")
    clear_background(user_sub, tenant)


from pydantic import BaseModel
import uuid
from urllib.parse import urlparse

class CreateTemplateRequest(BaseModel):
    name: str
    source_user_sub: str

class ApplyTemplateRequest(BaseModel):
    target_user_sub: str

def require_admin(user: dict, settings: Settings) -> None:
    if settings.auth_disabled:
        return
    roles = user.get("roles") or []
    if "portal-admin" in roles or "platform-admin" in roles:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permissions required")

@router.get("/templates")
def list_templates(
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list:
    require_admin(user, settings)
    tenant = resolve_user_context(user, settings)
    from app.db.tenant_engine import get_tenant_db_session
    from app.models.user_shell_prefs import ShellPrefsTemplateRow
    with get_tenant_db_session(tenant) as session:
        rows = session.query(ShellPrefsTemplateRow).filter(ShellPrefsTemplateRow.tenant == tenant).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "hasBackground": r.background is not None,
                "prefs_json": r.prefs_json or {},
            }
            for r in rows
        ]

@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(
    body: CreateTemplateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    require_admin(user, settings)
    tenant = resolve_user_context(user, settings)
    from app.db.tenant_engine import get_tenant_db_session
    from app.models.user_shell_prefs import UserShellPrefsRow, ShellPrefsTemplateRow
    with get_tenant_db_session(tenant) as session:
        source = session.get(UserShellPrefsRow, {"user_sub": body.source_user_sub, "tenant": tenant})
        bg_data = source.background if source else None
        bg_mime = source.background_mime if source else None
        prefs = source.prefs_json if source else None

        template_id = str(uuid.uuid4())
        template = ShellPrefsTemplateRow(
            id=template_id,
            tenant=tenant,
            name=body.name,
            background=bg_data,
            background_mime=bg_mime,
            prefs_json=prefs,
        )
        session.add(template)
        session.commit()
        return {
            "id": template_id,
            "name": template.name,
            "hasBackground": template.background is not None,
            "prefs_json": template.prefs_json or {},
        }

@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: str,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    require_admin(user, settings)
    tenant = resolve_user_context(user, settings)
    from app.db.tenant_engine import get_tenant_db_session
    from app.models.user_shell_prefs import ShellPrefsTemplateRow
    with get_tenant_db_session(tenant) as session:
        row = session.get(ShellPrefsTemplateRow, {"id": template_id, "tenant": tenant})
        if row:
            session.delete(row)
            session.commit()

@router.post("/templates/{template_id}/apply", status_code=status.HTTP_204_NO_CONTENT)
def apply_template(
    template_id: str,
    body: ApplyTemplateRequest,
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    require_admin(user, settings)
    tenant = resolve_user_context(user, settings)
    from app.db.tenant_engine import get_tenant_db_session
    from app.models.user_shell_prefs import UserShellPrefsRow, ShellPrefsTemplateRow
    with get_tenant_db_session(tenant) as session:
        template = session.get(ShellPrefsTemplateRow, {"id": template_id, "tenant": tenant})
        if not template:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        
        target = session.get(UserShellPrefsRow, {"user_sub": body.target_user_sub, "tenant": tenant})
        if target is None:
            target = UserShellPrefsRow(user_sub=body.target_user_sub, tenant=tenant)
            session.add(target)
        target.background = template.background
        target.background_mime = template.background_mime
        target.prefs_json = template.prefs_json
        session.commit()


import httpx

def _frame_ancestors_allows(csp: str, parent_origin: str) -> bool:
    """Whether frame-ancestors in `csp` permits a page served from `parent_origin`.

    The directive is an allow-LIST, so the question is whether our origin is on
    it — not whether any particular token appears in it. Testing for the presence
    of "self" answered False for
        frame-ancestors 'self' https://portal.example https://tenant.example
    which names the portal explicitly two tokens later: every app that permits
    the portal alongside itself was reported unembeddable, and the shell fell
    back to opening a browser tab.
    """
    directive = ""
    for part in csp.split(";"):
        part = part.strip()
        if part.lower().startswith("frame-ancestors"):
            directive = part
            break
    if not directive:
        return True

    sources = directive.split()[1:]
    if not sources or any(s == "'none'" for s in sources):
        return False
    if any(s == "*" for s in sources):
        return True
    if not parent_origin:
        # Without knowing where the shell is served from, only a wildcard can be
        # judged. Assume embeddable and let the browser decide rather than
        # opening a tab the user did not ask for.
        return True

    parsed = urlparse(parent_origin)
    host, scheme = parsed.hostname or "", parsed.scheme or "https"
    for src in sources:
        src = src.strip("'")
        if src in {"self"}:
            continue  # same-origin only; the shell is a different origin
        src_parsed = urlparse(src if "//" in src else f"//{src}")
        src_host = src_parsed.hostname or src
        if src_parsed.scheme and src_parsed.scheme != scheme:
            continue
        if src_host == host:
            return True
        if src_host.startswith("*.") and host.endswith(src_host[1:]):
            return True
    return False


@router.get("/check-iframe")
async def check_iframe_embeddable(url: str, request: Request) -> dict:
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(headers=headers) as client:
            resp = await client.head(url, timeout=2.0, follow_redirects=True)
            if resp.status_code in {404, 405}:
                resp = await client.get(url, timeout=2.0, follow_redirects=True)
            
            if resp.status_code in {401, 403}:
                return {"embeddable": False}

            resp_headers = resp.headers
            x_frame = resp_headers.get("x-frame-options", "").lower()
            csp = resp_headers.get("content-security-policy", "").lower()
            if "deny" in x_frame or "sameorigin" in x_frame:
                return {"embeddable": False}
            # The origin the shell is served from, which is what
            # frame-ancestors is asked about.
            parent = request.headers.get("origin") or ""
            if not parent:
                referer = request.headers.get("referer") or ""
                if referer:
                    r = urlparse(referer)
                    if r.scheme and r.hostname:
                        parent = f"{r.scheme}://{r.netloc}"
            if not _frame_ancestors_allows(csp, parent):
                return {"embeddable": False}
            return {"embeddable": True}
    except Exception:
        return {"embeddable": True}
