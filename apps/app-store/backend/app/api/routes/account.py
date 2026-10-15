"""What a person says at the store in their own name: their review of an
entry, and the company they are with.

Signed-in calls, made with the person's store token, which stays in this
process (`app.store.oauth`). They concern the person's account at the store
and nothing on the cluster: no cluster service is asked, and nothing here is
the tenant's. What the bundle sends is checked against the definition's
shape before it leaves, and what the store answers is checked again on the
way back.

A store that has not got these (no `review-writing` or `company` in its
features) answers 404 to the reads, which is answered here as "none"; the
bundle does not offer the writes then.
"""

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import ConfigDict

from app.api.deps import session_of
from app.core.config import Settings, get_settings
from app.core.problems import Refusal
from app.store import models, oauth
from app.store.client import get_store

router = APIRouter(prefix="/store", tags=["account"])


class ReviewBody(models.ReviewRequest):
    pass


class CompanyBody(models.Company):
    model_config = ConfigDict(extra="forbid")


async def _signed(session: str, call):
    """One signed-in call; a 401 from the store ends the sign-in."""
    token = oauth.require(session).token
    try:
        return await call(token)
    except Refusal as exc:
        oauth.forget_if_unauthenticated(session, exc)
        raise


@router.get("/apps/{catalogue}/{app}/reviews/mine")
async def my_review(
    catalogue: str,
    app: str,
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    store = get_store(settings)
    found = await _signed(session, lambda t: store.my_review(t, session, catalogue, app))
    return {"review": found.model_dump() if found else None}


@router.put("/apps/{catalogue}/{app}/reviews/mine")
async def write_review(
    catalogue: str,
    app: str,
    body: ReviewBody,
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Write the person's review, or replace the one they wrote. The store's
    refusals -- no company yet, not acquired, the tenant not served -- are
    handed on as it said them."""
    store = get_store(settings)
    written = await _signed(
        session, lambda t: store.put_my_review(t, session, catalogue, app, body)
    )
    return {"review": written.model_dump()}


@router.delete("/apps/{catalogue}/{app}/reviews/mine")
async def withdraw_review(
    catalogue: str,
    app: str,
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    store = get_store(settings)
    await _signed(session, lambda t: store.delete_my_review(t, session, catalogue, app))
    return {"review": None}


@router.get("/account/company")
async def company(
    session: str = Depends(session_of), settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    store = get_store(settings)
    found = await _signed(session, lambda t: store.company(t, session))
    return {"company": found.model_dump() if found else None}


@router.put("/account/company")
async def set_company(
    body: CompanyBody,
    session: str = Depends(session_of),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    store = get_store(settings)
    recorded = await _signed(session, lambda t: store.put_company(t, session, body))
    return {"company": recorded.model_dump()}
