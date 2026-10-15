"""The store's answers, as this app accepts them.

Written to the store API's definition. An answer that does not fit is not the
format, and is treated as the store being unreachable; a confirmation that
does not fit is not acted on in part. Members the definition does not name
are dropped here, so nothing a store adds reaches the browser unread: what
leaves this module is what the definition says an answer holds.

Closed enumerations are closed: an entry with an edition outside the four is
refused. Open ones are plain strings, and the screen falls back as the
definition says.
"""

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.store.patterns import (
    ACQUISITION_ID_PATTERN,
    COORDINATE_PATTERN,
    DIGEST_PATTERN,
    NAME_PATTERN,
    REPOSITORY_URL_PATTERN,
)


def Matching(pattern: str, limit: int = 2048):
    """A string that is the pattern from its first character to its last.
    Python's $ also matches before a trailing newline; fullmatch does not."""
    compiled = re.compile(pattern)

    def check(value: str) -> str:
        if len(value) > limit or not compiled.fullmatch(value):
            raise ValueError("does not match the definition's pattern")
        return value

    return Annotated[str, AfterValidator(check)]


def _https_url(value: str) -> str:
    """An absolute https URL with a host and no credentials in it."""
    if len(value) > 2048 or any(c.isspace() or ord(c) < 0x20 for c in value):
        raise ValueError("not an https URL")
    try:
        parts = urlsplit(value)
        host = parts.hostname
        _ = parts.port
    except ValueError as exc:
        raise ValueError("not an https URL") from exc
    if parts.scheme != "https" or not host or parts.username or parts.password:
        raise ValueError("not an https URL")
    return value


def _no_trailing_slash(value: str) -> str:
    if value.endswith("/"):
        raise ValueError("a repository address has no trailing slash")
    return value


def _trimmed(value: str) -> str:
    if value != value.strip():
        raise ValueError("leading or trailing whitespace")
    return value


HttpsUrl = Annotated[str, AfterValidator(_https_url)]
Name = Matching(NAME_PATTERN)
Coordinate = Matching(COORDINATE_PATTERN)
Digest = Matching(DIGEST_PATTERN)
AcquisitionId = Matching(ACQUISITION_ID_PATTERN)
Edition = Literal["ce", "pe", "me", "ee"]
TrustTier = Literal["platform", "certified", "experimental"]


def Text(limit: int, minimum: int = 0):
    return Annotated[str, StringConstraints(max_length=limit, min_length=minimum)]


class Model(BaseModel):
    # Unknown members are ignored: /v1 grows by addition.
    model_config = ConfigDict(extra="ignore")


class MetaLinks(Model):
    terms: HttpsUrl | None = None
    privacy: HttpsUrl | None = None
    support: HttpsUrl | None = None
    account: HttpsUrl | None = None


CompanySize = Literal["1-9", "10-49", "50-249", "250-999", "1000+"]
Industry = Literal[
    "agriculture",
    "mining",
    "manufacturing",
    "energy",
    "water-waste",
    "construction",
    "wholesale-retail",
    "transport-logistics",
    "accommodation-food",
    "information-communication",
    "finance-insurance",
    "real-estate",
    "professional-scientific",
    "administrative-support",
    "public-administration",
    "education",
    "health-social",
    "arts-entertainment",
    "other-services",
    "households",
    "extraterritorial",
]


class SizeName(Model):
    id: CompanySize
    name: Text(80)


class IndustryName(Model):
    id: Industry
    name: Text(80)
    nace: Matching(r"^[A-U]$", 1)


class Reviewing(Model):
    requireAcquisition: bool


def _known_only(model: type["Model"]):
    """A list of a meta's choices, each on its own: one this app does not
    know is left out, rather than taking the store's description with it."""

    def keep(value: Any) -> Any:
        if not isinstance(value, list):
            return value
        out = []
        for item in value:
            try:
                out.append(model.model_validate(item))
            except ValueError:
                continue
        return out

    return keep


class Meta(Model):
    apiVersion: Matching(r"^1\.[0-9]+$", 20)
    name: Text(80)
    issuer: HttpsUrl
    clientId: Text(200, 1)
    scopes: list[Text(100)]
    defaultLanguage: Text(35)
    languages: list[Text(35)]
    mediaOrigins: list[Text(300)]
    checkoutOrigins: list[Text(300)]
    features: list[Text(100)]
    links: MetaLinks | None = None
    # 1.1. A 1.0 store names none of these, and nothing asks for them then.
    companySizes: Annotated[list[SizeName], BeforeValidator(_known_only(SizeName))] = []
    industries: Annotated[list[IndustryName], BeforeValidator(_known_only(IndustryName))] = []
    reviewing: Reviewing | None = None


class Link(Model):
    rel: Text(40) | None = None
    label: Text(80) | None = None
    url: HttpsUrl


class Notice(Model):
    type: Text(60)
    severity: Literal["info", "warning"]
    title: Text(120) | None = None
    text: Text(2000)
    link: Link | None = None


class TenantRefusal(Model):
    reason: Text(60)
    detail: Text(2000)
    link: Link | None = None


# What an account may do for a tenant (store API 1.2, `tenant-access`).
# Open: a value this app does not know is taken for "none".
TenantRole = Literal["holder", "manager", "requested", "declined", "none"]


def _role(value: Any) -> Any:
    return value if value in ("holder", "manager", "requested", "declined", "none") else "none"


class TenantAccessRole(Model):
    role: Annotated[TenantRole, BeforeValidator(_role)] = "none"


class TenantStanding(Model):
    tenantUrl: Text(300)
    known: bool
    lastReportAt: Text(40) | None = None
    served: bool
    refusal: TenantRefusal | None
    notices: list[Notice]
    # 1.2. A 1.1 store says nothing of it: its one account manages the tenant.
    access: TenantAccessRole | None = None


SUBJECT = re.compile(r"^[A-Za-z0-9._:@-]{1,256}$")


class TenantAccount(Model):
    subject: Matching(r"^[A-Za-z0-9._:@-]{1,256}$", 256)
    name: Text(200) | None = None
    email: Text(254) | None = None
    role: Annotated[TenantRole, BeforeValidator(_role)]
    since: Text(40)


class TenantAccess(Model):
    role: Annotated[TenantRole, BeforeValidator(_role)]
    accounts: Annotated[list[TenantAccount], BeforeValidator(_known_only(TenantAccount))] = []


class Category(Model):
    id: Name
    name: Text(80)


class Publisher(Model):
    name: Text(120)
    url: HttpsUrl | None = None


class EditionRef(Model):
    edition: Edition
    coordinate: Coordinate


class Price(Model):
    model: Literal["free", "one-time", "subscription", "quote"]
    amount: Matching(r"^[0-9]+(\.[0-9]{1,4})?$", 40) | None = None
    currency: Matching(r"^[A-Z]{3}$", 3) | None = None
    per: Literal["tenant", "user"] | None = None
    period: Literal["month", "year"] | None = None
    note: Text(300) | None = None


class Distribution(Model):
    one: int = Field(ge=0, alias="1")
    two: int = Field(ge=0, alias="2")
    three: int = Field(ge=0, alias="3")
    four: int = Field(ge=0, alias="4")
    five: int = Field(ge=0, alias="5")


class Recommend(Model):
    yes: int = Field(ge=0)
    no: int = Field(ge=0)


class ScoreSummary(Model):
    average: float | None = Field(ge=1, le=5)
    count: int = Field(ge=0)


class ScoreSummaries(Model):
    features: ScoreSummary
    easeOfUse: ScoreSummary
    easeOfSetup: ScoreSummary
    support: ScoreSummary
    value: ScoreSummary


class ReviewSummary(Model):
    count: int = Field(ge=0)
    average: float | None = Field(ge=1, le=5)
    distribution: Distribution
    # 1.1: absent from a 1.0 store's answer.
    recommend: Recommend | None = None
    scores: ScoreSummaries | None = None


class AppSummary(Model):
    coordinate: Coordinate
    family: Name
    name: Text(80)
    summary: Text(300)
    iconUrl: HttpsUrl | None
    categories: list[Text(63)]
    publisher: Publisher
    edition: Edition
    editions: list[EditionRef] = Field(min_length=1)
    trustTier: TrustTier
    latestVersion: Text(64)
    price: Price
    rating: ReviewSummary | None = None


class Screenshot(Model):
    url: HttpsUrl
    contentType: Literal["image/png", "image/jpeg", "image/webp"]
    width: int | None = None
    height: int | None = None
    caption: Text(200) | None = None


class Resources(Model):
    cpu: Text(40) | None = None
    memory: Text(40) | None = None
    storage: Text(40) | None = None


class Requirements(Model):
    platform: Text(80) | None = None
    resources: Resources | None = None
    notes: list[Text(300)] | None = None


class Version(Model):
    version: Text(64, 1)
    digest: Digest
    releasedAt: Text(40)
    releaseNotes: Text(20000)
    requirements: Requirements


class AddonRef(Model):
    coordinate: Coordinate
    name: Text(80)
    summary: Text(300)


class License(Model):
    spdx: Text(120) | None = None
    name: Text(120)
    url: HttpsUrl | None = None


class AppDetail(AppSummary):
    description: Text(20000)
    screenshots: list[Screenshot]
    versions: list[Version] = Field(min_length=1, max_length=50)
    addons: list[AddonRef]
    addonOf: Coordinate | None
    links: list[Link]
    license: License | None


Stars = Annotated[int, Field(ge=1, le=5)]


class ReviewScores(Model):
    """`support` and `value` are for an entry of edition `ee`."""

    features: Stars
    easeOfUse: Stars
    easeOfSetup: Stars
    support: Stars | None
    value: Stars | None


class Reviewer(Model):
    size: CompanySize
    industry: Industry


class Review(Model):
    id: Text(100)
    rating: int = Field(ge=1, le=5)
    title: Text(120) | None = None
    text: Text(5000)
    author: Text(80)
    date: Text(40)
    language: Text(35) | None = None
    version: Text(64) | None = None
    recommend: bool | None = None
    scores: ReviewScores | None = None
    reviewer: Reviewer | None = None
    mine: bool = False


class Company(Model):
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    size: CompanySize
    industry: Industry


class ReviewRequest(Model):
    """What a person writes, as this app sends it on. Built from the
    bundle's body, which is checked against this before it leaves."""

    model_config = ConfigDict(extra="forbid")

    recommend: bool
    scores: ReviewScores
    title: Text(120) | None = None
    text: Text(5000)
    version: Text(64) | None = None


class Report(Model):
    id: Text(100)
    kind: Text(60)
    title: Text(200)
    issuer: Text(120) | None = None
    date: Text(40)
    summary: Text(2000)
    version: Text(64) | None = None
    documentUrl: HttpsUrl
    documentType: Text(100) | None = None


class Credential(Model):
    """The tenant's registry credential. Opaque here: handed to the custodian
    once and never returned, logged or shown."""

    username: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    token: Annotated[
        str, StringConstraints(min_length=1, max_length=4096), AfterValidator(_trimmed)
    ] = Field(repr=False)
    expiresAt: Text(40) | None


class Repository(Model):
    # Closed, one value. A git repository of apps is a source of profiles on
    # a cluster, which is exactly what a store may not supply: a confirmation
    # naming one does not validate, and is not acted on.
    type: Literal["oci"]
    url: Annotated[Matching(REPOSITORY_URL_PATTERN, 500), AfterValidator(_no_trailing_slash)]
    credential: Credential | None = None


class ConfirmedItem(Model):
    coordinate: Coordinate
    version: Text(64, 1)
    digest: Digest
    repository: Repository | None = None


class Confirmation(ConfirmedItem):
    addons: list[ConfirmedItem]

    def items(self) -> list[ConfirmedItem]:
        return [self, *self.addons]


class Failure(Model):
    reason: Text(60)
    detail: Text(2000)


class Acquisition(Model):
    id: AcquisitionId
    coordinate: Coordinate
    status: Literal["pending", "confirmed", "cancelled", "failed"]
    createdAt: Text(40)
    updatedAt: Text(40)
    # 1.2: what a pending acquisition waits for. Open: an unknown value is
    # taken for "confirmation". A 1.1 store sends none: every pending one is
    # at a checkout.
    waitingFor: Annotated[
        Literal["confirmation", "approval", "checkout"] | None,
        BeforeValidator(
            lambda v: v if v in (None, "confirmation", "approval", "checkout") else "confirmation"
        ),
    ] = None
    checkoutUrl: HttpsUrl | None
    checkoutExpiresAt: Text(40) | None
    failure: Failure | None
    confirmation: Confirmation | None

    @model_validator(mode="after")
    def confirmed_carries_its_confirmation(self) -> "Acquisition":
        if self.status == "confirmed" and self.confirmation is None:
            raise ValueError("a confirmed acquisition carries its confirmation")
        if self.confirmation is not None and self.confirmation.coordinate != self.coordinate:
            raise ValueError("the confirmation is for another entry than its acquisition")
        return self


class NotTheShape(ValueError):
    """An answer whose outline is not the definition's."""


def parse_items(model: type[Model], raw: Any) -> tuple[list[Any], int]:
    """Each item of a list on its own: one that does not fit is left out and
    counted, rather than taking the page with it. Answers (items, omitted)."""
    if not isinstance(raw, list):
        raise NotTheShape("items is not a list")
    out, omitted = [], 0
    for item in raw:
        try:
            out.append(model.model_validate(item))
        except ValueError:
            omitted += 1
    return out, omitted
