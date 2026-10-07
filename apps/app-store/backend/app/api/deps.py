"""What every route of this API is given: who is asking, and on whose behalf.

The caller is verified once (`get_current_user`), the bearer is the one the
edge forwarded and is relayed to the cluster's services as it is, and the
store sign-in a request may use is the one of its own cluster session.
"""

import re

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.auth import bearer_of, get_current_user, session_key
from app.core.config import Settings, get_settings
from app.install.sequence import Context
from app.store.client import get_store

_bearer = HTTPBearer(auto_error=False)

# RFC 9110 language ranges with weights, and nothing else: the header goes to
# a store as it is.
_LANGUAGE = re.compile(r"[A-Za-z0-9*,;=. -]{1,200}")


def language_of(request: Request) -> str | None:
    """The languages the person reads, as their browser states them."""
    value = request.headers.get("accept-language", "").strip()
    return value if _LANGUAGE.fullmatch(value) else None


def session_of(user: dict = Depends(get_current_user)) -> str:
    return session_key(user)


def context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> Context:
    return Context(
        settings=settings,
        store=get_store(settings),
        session=session,
        cluster_token=bearer_of(credentials),
        language=language_of(request),
    )
