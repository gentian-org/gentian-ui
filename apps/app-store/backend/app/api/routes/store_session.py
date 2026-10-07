"""The person's sign-in to the store: starting it, finishing it, ending it.

Asked for only when the person acquires something or opens what the tenant
has acquired; browsing never needs it. What the browser learns is that the
person is signed in, and how the store regards the tenant. The token is this
process's and stays here (`app.store.oauth`).
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse

from app.api.deps import language_of, session_of
from app.core.config import Settings, get_settings
from app.core.problems import Refusal
from app.install import sequence
from app.store import oauth
from app.store.client import get_store

router = APIRouter(prefix="/store", tags=["store session"])
# The issuer redirects the browser here, and to no other address: it is the
# one redirect address of this tenant, so it is not under the API's prefix.
callback_router = APIRouter(tags=["store session"])

# Where the callback leaves the window it arrived in: a page of the bundle's
# that says what happened, in the person's language.
_DONE = "/signed-in"


def _view(session: str) -> dict[str, Any]:
    signed_in = oauth.current(session)
    if signed_in is None:
        return {"signedIn": False, "expiresInSeconds": None, "standing": None}
    standing = signed_in.standing
    return {
        "signedIn": True,
        "expiresInSeconds": oauth.seconds_left(signed_in),
        "standing": standing.model_dump() if standing else None,
    }


@router.get("/session")
async def session(
    request: Request,
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if oauth.current(session) is not None:
        try:
            # Asked once after each sign-in, before anything else; here when
            # the callback could not.
            await oauth.standing(get_store(settings), session, language_of(request))
        except Refusal:
            pass
    return _view(session)


@router.post("/sign-in")
async def sign_in(
    session: str = Depends(session_of), settings: Settings = Depends(get_settings)
) -> dict[str, str]:
    """Start a sign-in: the address at the store's issuer to open in a
    separate window. `state` and the PKCE verifier stay here."""
    store = get_store(settings)
    return {"authorizationUrl": await oauth.begin(settings, store, session)}


@router.delete("/session")
async def sign_out(session: str = Depends(session_of)) -> dict[str, Any]:
    """Sign out of the store: the token is dropped, and with it every
    sequence that was holding something on its strength."""
    oauth.sign_out(session)
    sequence.drop_session(session)
    return _view(session)


@callback_router.get("/oauth/callback", include_in_schema=False)
async def callback(
    request: Request,
    code: str | None = Query(default=None, max_length=4096),
    state: str | None = Query(default=None, max_length=200),
    error: str | None = Query(default=None, max_length=200),
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    """The issuer's redirect. The code is exchanged here, by this process,
    and the browser is sent on to a page that says how it went -- with a
    reason from a fixed set, never with anything the query said."""
    reason: str | None = None
    try:
        if error is not None:
            # The issuer refused, or the person did. The state is used up
            # either way.
            await oauth.complete(session, None, state)
        else:
            await oauth.complete(session, code, state)
    except oauth.SignInRefused as refused:
        reason = "denied" if error is not None and refused.reason == "code" else refused.reason
    if reason is None:
        try:
            await oauth.standing(get_store(settings), session, language_of(request))
        except Refusal:
            # Signed in all the same; the standing is asked again before the
            # first call that needs it.
            pass
    target = _DONE if reason is None else f"{_DONE}?error={reason}"
    return RedirectResponse(target, status_code=303)
