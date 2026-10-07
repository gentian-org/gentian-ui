"""Acquiring and installing an entry, and what the tenant has.

Every route here acts for the tenant this app runs in, with the person's own
tokens: the store's for what concerns the tenant at the store, the cluster's
for everything asked of the director, the custodian and the usher. This
module decides nothing about who may do what, and no answer of it carries a
credential.

Uninstalling and purging are not here. An installed app is administered in
the Admin Console's Apps tab.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import context
from app.core.problems import Refusal
from app.install import sequence, state
from app.install.sequence import Context
from app.store import oauth, patterns

router = APIRouter(tags=["install"])


def _coordinate(catalogue: str, app: str) -> str:
    return f"{patterns.name(catalogue, 'catalogue')}/{patterns.name(app, 'app')}"


@router.get("/overview")
async def overview(ctx: Context = Depends(context)) -> dict[str, Any]:
    """Installed and acquired: the cluster's side always, the store's side
    when the person is signed in to it."""
    return await state.overview(ctx)


@router.get("/apps/{catalogue}/{app}/state")
async def app_state(catalogue: str, app: str, ctx: Context = Depends(context)) -> dict[str, Any]:
    return await state.of_app(ctx, _coordinate(catalogue, app))


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["install", "update"] = "install"
    # "Install for everyone": every member of the tenant has access by
    # default. The person's choice, never the store's.
    forEveryone: bool = False
    # The build the person was shown. A confirmation for another build is
    # put before them first.
    expectedDigest: str
    version: str | None = None
    # The tenant's live acquisition of the entry, when it has one: it is then
    # read, and nothing is acquired again.
    acquisitionId: str | None = None


@router.post("/apps/{catalogue}/{app}/operation")
async def start(
    catalogue: str, app: str, body: StartBody, ctx: Context = Depends(context)
) -> dict[str, Any]:
    """Begin, or begin again, the sequence for one entry, and do its first
    step."""
    oauth.require(ctx.session)
    if body.mode == "update" and body.acquisitionId is None:
        raise Refusal(
            status=400,
            source="app",
            code="invalid-request",
            detail="An update names the acquisition it is for.",
        )
    operation = sequence.start(
        ctx.session,
        _coordinate(catalogue, app),
        mode=body.mode,
        for_everyone=body.forEveryone,
        expected_digest=body.expectedDigest,
        version=body.version,
        acquisition_id=body.acquisitionId,
    )
    await sequence.advance(ctx, operation)
    return operation.view()


class AdvanceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    retry: bool = False
    # `continue` on the wire; a reserved word here.
    continue_: bool = Field(default=False, alias="continue")
    # The digest the person confirmed, as they were shown it.
    confirmDigest: str | None = None
    # What the person typed where the director asked for a name repeated.
    confirmRepository: str | None = None


@router.post("/apps/{catalogue}/{app}/operation/advance")
async def advance(
    catalogue: str, app: str, body: AdvanceBody, ctx: Context = Depends(context)
) -> dict[str, Any]:
    """Do the next step of a sequence, and say where it stands."""
    operation = sequence.find(ctx.session, _coordinate(catalogue, app))
    if operation is None:
        raise Refusal(status=404, source="app", code="no-operation")
    await sequence.advance(
        ctx,
        operation,
        {
            "retry": body.retry,
            "continue": body.continue_,
            "confirmDigest": body.confirmDigest,
            "confirmRepository": body.confirmRepository,
        },
    )
    return operation.view()


@router.delete("/apps/{catalogue}/{app}/operation")
async def stop(catalogue: str, app: str, ctx: Context = Depends(context)) -> dict[str, Any]:
    """Stop waiting. Nothing is undone and nothing is cancelled at the store:
    this app forgets its place, and the page shows where things stand."""
    coordinate = _coordinate(catalogue, app)
    sequence.drop(ctx.session, coordinate)
    return await state.of_app(ctx, coordinate)


class CredentialBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # True: ask the store to replace the credential first (it may have
    # leaked). False: set the one that is valid now again.
    rotate: bool = False


@router.post("/acquisitions/{acquisition_id}/credential")
async def credential(
    acquisition_id: str, body: CredentialBody, ctx: Context = Depends(context)
) -> dict[str, Any]:
    """Hand an acquisition's repository credential to the custodian again.
    The answer says, per repository, whether it was set -- and never what it
    is."""
    return await sequence.set_credentials(
        ctx, patterns.acquisition_id(acquisition_id), rotate=body.rotate
    )
