"""The contract `notices`: a granted component puts a notice in an inbox.

The desktop provides the contract. A component the tenant's administrator
granted it to is told this address and the contract's credential by the
platform, and presents the credential as a bearer. Nobody else has it, and
a person's token is not the credential. The route is at /contracts/v1/notices,
outside the prefix the edge routes: it is reached from inside the cluster,
over the network path the grant opens, and from nowhere else.

The notice is stored for the tenant this desktop serves and for nobody
outside it: the people it names, the groups of this tenant it names, or both.
"""

from __future__ import annotations

import hmac
import json
import logging
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)

from app.core.config import Settings, get_settings
from app.core.gentian_groups import tenant_prefix
from app.services.admin_notifications import NotificationAudience
from app.services.notification_store import NotificationStoreDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notices", tags=["notices"])

_Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
_Body = Annotated[str, StringConstraints(min_length=1, max_length=4000)]
_Publisher = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
# 320 is the longest an email address can be.
_Person = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=320)]
_Group = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class NoticeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: _Title
    body: _Body
    severity: Literal["info", "warning", "critical"] = "info"
    # Who the notice is from, as the inbox shows it.
    publisher: _Publisher
    # People by subject, username or email address.
    people: list[_Person] = Field(default_factory=list, max_length=50)
    # Groups of this desktop's tenant.
    groups: list[_Group] = Field(default_factory=list, max_length=20)
    linkUrl: str | None = Field(default=None, max_length=2048)
    linkLabel: str | None = Field(default=None, max_length=100)

    @field_validator("linkUrl")
    @classmethod
    def _https_link(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parts = urlsplit(value)
        except ValueError as exc:
            raise ValueError("linkUrl is not a URL") from exc
        if parts.scheme != "https" or not parts.hostname:
            raise ValueError("linkUrl must be an https URL")
        return value

    @model_validator(mode="after")
    def _addressed(self) -> "NoticeRequest":
        if not self.people and not self.groups:
            raise ValueError("a notice names at least one of people or groups")
        return self


class NoticeResponse(BaseModel):
    id: str


def require_notices_key(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    """The caller presents the contract's credential, or is refused.

    Checked before the body is read, and against nothing but the credential:
    no token of the realm is looked at here.
    """
    expected = settings.notices_key.get_secret_value() if settings.notices_key else ""
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="no component has been granted the contract",
        )
    scheme, _, presented = (authorization or "").partition(" ")
    presented = presented.strip()
    if (
        scheme.lower() != "bearer"
        or not presented
        or not hmac.compare_digest(presented.encode("utf-8"), expected.encode("utf-8"))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="the contract's credential is required",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _tenant(settings: Settings) -> str:
    # The tenant the operator states, which is the one the inbox reads.
    if settings.gentian_tenant:
        return settings.gentian_tenant
    if settings.auth_disabled:
        # Local development: the tenant of the stand-in user.
        return "demo"
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="This desktop was not told which tenant it serves.",
    )


# What the body may run to: the longest notice the fields allow is well below.
_MAX_BODY_BYTES = 64 * 1024
_UNPROCESSABLE = 422


@router.post(
    "",
    response_model=NoticeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_notices_key)],
    # The body is read here and not by the framework, which reads it before
    # it asks who is calling: a caller without the credential is told
    # nothing about what a notice looks like.
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": NoticeRequest.model_json_schema()}},
        }
    },
)
async def publish_notice(
    request: Request,
    settings: Settings = Depends(get_settings),
    *,
    store: NotificationStoreDep,
) -> NoticeResponse:
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The notice is too large."
        )
    try:
        notice = NoticeRequest.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=_UNPROCESSABLE,
            detail=json.loads(exc.json(include_url=False, include_input=False)),
        ) from exc

    tenant = _tenant(settings)
    prefix = tenant_prefix(tenant)
    for group in notice.groups:
        if not group.startswith(prefix):
            raise HTTPException(
                status_code=_UNPROCESSABLE,
                detail=f"Group {group} is outside tenant {tenant}",
            )
    stored = await store.publish(
        tenant=tenant,
        title=notice.title,
        body=notice.body,
        severity=notice.severity,
        audience=NotificationAudience(
            scope="tenant",
            tenant=tenant,
            groups=list(notice.groups),
            people=list(notice.people),
        ),
        publisher=notice.publisher,
        link_url=notice.linkUrl,
        link_label=notice.linkLabel,
    )
    logger.info(
        "notice %s published for tenant %s by %r: %d people, %d groups",
        stored.id,
        tenant,
        notice.publisher,
        len(notice.people),
        len(notice.groups),
    )
    return NoticeResponse(id=stored.id)
