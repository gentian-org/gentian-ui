from fastapi import APIRouter, Response, status

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
def readyz(response: Response) -> dict[str, object]:
    """Ready means this app can do the first thing it does: verify the
    forwarded token and ask the director what the caller may do. A store that
    is not named is not a reason to be unready -- the app then says that no
    App Store is configured, which is an answer."""
    settings = get_settings()
    checks: dict[str, str] = {}
    errors: list[str] = []

    if settings.is_production and not settings.oidc_issuer:
        errors.append("OIDC_ISSUER required in production")
    if not settings.director_url:
        errors.append("DIRECTOR_URL is required: this app asks the director who may install")

    checks["oidc"] = "ok" if settings.oidc_issuer or not settings.is_production else "missing"
    checks["director"] = "configured" if settings.director_url else "missing"
    checks["store"] = "configured" if settings.store_base else "none"
    checks["host"] = "configured" if settings.host else "missing"

    if errors:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready", "checks": checks, "errors": errors}
    return {"status": "ready", "checks": checks}
