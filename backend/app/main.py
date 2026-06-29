from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, apps, health, notifications, prefs, session
from app.core.config import get_settings
from app.core.logging_middleware import RedactingAccessLogMiddleware
from app.db.engine import init_audit_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.database_url:
        init_audit_database(settings.database_url)
    yield


app = FastAPI(
    title=settings.project_name,
    openapi_url=f"{settings.api_v1_str}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(RedactingAccessLogMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(session.router, prefix=settings.api_v1_str)
app.include_router(apps.router, prefix=settings.api_v1_str)
app.include_router(prefs.router, prefix=settings.api_v1_str)
app.include_router(admin.router, prefix=settings.api_v1_str)
app.include_router(notifications.router, prefix=settings.api_v1_str)
