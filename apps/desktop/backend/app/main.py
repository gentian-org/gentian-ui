from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    account,
    cluster,
    health,
    llm,
    notifications,
    prefs,
    session,
)
from app.core.config import get_settings
from app.core.logging_middleware import RedactingAccessLogMiddleware
from app.db.engine import init_portal_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.database_url:
        init_portal_database(settings.database_url)
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

# What this service is: a relay for tiles, plus the shell's own preferences.
# It shows what a signed-in person may open and opens it. Nothing here
# installs, removes, grants or configures anything: administering apps is the
# administration console's, and an App Store, where a cluster has one, is an
# app of its own that arrives as an ordinary tile.
#
# These used to be here and are gone, because each one made the desktop
# load-bearing (gentian-os S7A.6):
#
#   admin  a copy of the administration console, reading and writing the realm
#          through a Keycloak administrator credential. The console is its own
#          component now, at admin.<zone>, and it holds nothing.
#   auth   the login page's realm lookups, a post-login hook that traded the
#          user's token for an OpenBao one, and sign-out through Keycloak's
#          admin API. The edge owns sign-in and sign-out; nothing here needs to
#          know which realm a hostname belongs to, because the hostname IS the
#          zone.
#   proxy  a reverse proxy for external APIs, which put this service in the
#          data path of every call to them and needed a ServiceAccount that
#          could list cluster-scoped custom resources. The Gateway routes to an
#          API component now, with no application code in the path.
#   bridge one-time tickets this service minted for apps to redeem into a
#          session. Minting a credential is authority, and the desktop is not
#          where authority belongs.
#   store  the App Store's requests relayed to the director -- install,
#          uninstall, add-ons, purge, grant -- and with them the credential
#          and repository relays to the custodian. Each was something only an
#          administrator may do, reachable from the page every member has
#          open.
app.include_router(health.router)
app.include_router(session.router, prefix=settings.api_v1_str)
app.include_router(cluster.router, prefix=settings.api_v1_str)
app.include_router(prefs.router, prefix=settings.api_v1_str)
app.include_router(account.router, prefix=settings.api_v1_str)
app.include_router(notifications.router, prefix=settings.api_v1_str)
app.include_router(llm.router, prefix=settings.api_v1_str)
