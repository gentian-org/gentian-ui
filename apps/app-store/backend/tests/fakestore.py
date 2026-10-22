"""A store, for the tests.

It serves the examples the store API's definition is written with, and every
answer it gives on the API's own origin is validated against the definition
as it is given (`definition.Contract.check`). What it got wrong is collected in
`violations`, and the fixture that hands it to a test fails the test when
that list is not empty -- so the app is tested against the definition, not
against a fake that drifted from it.

Beside the API it stands in for the two other things a store runs: its issuer
(metadata and the token endpoint) and its media origin. Those are not part of
the definition's paths and are not validated against it.

Every request it receives is kept in `calls`, headers and body included, for
the tests that ask what this app sent.
"""

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs

import httpx
from definition import Contract

BASE = "https://store.example"
ISSUER = "https://accounts.store.example"
MEDIA = "https://media.store.example"

# Not a token: the shape of one, and a value the tests search answers and
# logs for.
STORE_TOKEN = "st-0e1f-EXAMPLE-ONLY-store-token-5b7c"
REFRESH_TOKEN = "rt-EXAMPLE-ONLY-refresh-token-9d2a"
REGISTRY_TOKEN = "3q2-EXAMPLE-ONLY-NOT-A-TOKEN-x7Lk"
ROTATED_TOKEN = "8m4-EXAMPLE-ONLY-ROTATED-TOKEN-p2Qz"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

PAID = "gentian/nextcloud-base-ee"
FREE = "gentian/xwiki-ce"
# An add-on of PAID: an entry of its own, acquired as an app is.
ADDON = "gentian/nextcloud-office-ee"
ADDON_DIGEST = "sha256:0b1c2d3e4f5a69788796a5f4e3d2c1b00b1c2d3e4f5a69788796a5f4e3d2c1b0"


@dataclass
class Call:
    method: str
    url: str
    path: str
    headers: dict[str, str]
    body: bytes
    query: dict[str, list[str]] = field(default_factory=dict)

    @property
    def json(self) -> Any:
        return json.loads(self.body) if self.body else None

    @property
    def form(self) -> dict[str, str]:
        return {k: v[0] for k, v in parse_qs(self.body.decode()).items()}


class FakeStore:
    def __init__(self, contract: Contract) -> None:
        self.contract = contract
        self.calls: list[Call] = []
        self.violations: list[str] = []
        self.answered: set[tuple[str, str]] = set()
        # What a test turns to get another answer.
        self.meta = contract.example("Meta")
        # A 1.1 store: it writes reviews and keeps an account's company. A
        # test of a 1.0 store takes these out again.
        self.meta["apiVersion"] = "1.1"
        self.meta["features"] += ["review-writing", "company"]
        self.meta["companySizes"] = [
            {"id": "1-9", "name": "1 to 9 people"},
            {"id": "10-49", "name": "10 to 49 people"},
            {"id": "50-249", "name": "50 to 249 people"},
            {"id": "250-999", "name": "250 to 999 people"},
            {"id": "1000+", "name": "1000 people or more"},
        ]
        self.meta["industries"] = [
            {
                "id": "information-communication",
                "name": "Information and communication",
                "nace": "J",
            },
            {"id": "education", "name": "Education", "nace": "P"},
        ]
        self.meta["reviewing"] = {"requireAcquisition": True}
        # 1.3: apps carry support offers, and a person may request one.
        if "support" not in self.meta["features"]:
            self.meta["features"].append("support")
        self.support_requests: list[dict] = []  # what the signed-in person asked for
        self.company: dict | None = None  # the signed-in account's
        # Who manages the tenant (1.2, tenant-access): the signed-in account
        # holds it, and one other account asks to manage it.
        self.access: dict = {
            "role": "holder",
            "accounts": [
                {
                    "subject": "5d1c0a2e-0b1f-4c55-9a43-1e2f3a4b5c6d",
                    "name": "Grace Hopper",
                    "email": "grace@acme.example",
                    "role": "requested",
                    "since": "2026-10-15T08:01:12Z",
                }
            ],
        }
        self.my_review: dict | None = None  # the signed-in person's, of PAID
        self.standing = contract.example("TenantServed")
        self.checkout = False  # a paid acquisition answers 202 first
        self.waiting_for: str | None = None  # ... or waits for approval, or confirmation
        self.checkout_url: str | None = None  # overrides the example's
        self.confirmed_digest: str | None = None  # a store confirming another build
        self.confirmed_addons: list[dict] = []
        self.metering: dict | None = None  # an app priced by use
        self.unavailable = False  # every API call answers 503
        self.rate_limited: int | None = None  # every API call answers 429 with this Retry-After
        self.token_expired = False  # signed-in calls answer 401
        self.redirect_to: str | None = None  # every API call answers a redirect there
        self.token_answer: dict[str, Any] = {
            "access_token": STORE_TOKEN,
            "token_type": "Bearer",
            "expires_in": 900,
            "refresh_token": REFRESH_TOKEN,
        }
        self.media: dict[str, tuple[str, bytes]] = {
            "/icons/nextcloud.png": ("image/png", PNG),
            "/shots/nextcloud-files.png": ("image/png", PNG),
        }
        self.acquisitions: dict[str, dict] = {}
        self.codes: dict[str, dict[str, str]] = {}  # code -> what the authorization bound
        self.registry_token = REGISTRY_TOKEN

    # ── the transport ───────────────────────────────────────────────────────

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        call = Call(
            method=request.method,
            url=str(request.url),
            path=request.url.path,
            headers={k.lower(): v for k, v in request.headers.items()},
            body=request.content,
            query=parse_qs(request.url.query.decode()),
        )
        self.calls.append(call)
        origin = f"{request.url.scheme}://{request.url.host}"
        if origin == BASE:
            response = self._api(call)
            template = self.contract.template(call.path)
            if template is not None:
                self.answered.add((call.method, template))
            if response.status_code // 100 != 3:
                self.violations += self.contract.check(
                    call.method,
                    call.path,
                    response.status_code,
                    response.headers.get("content-type", ""),
                    response.content,
                )
            return response
        if origin == ISSUER:
            return self._issuer(call)
        if origin == MEDIA:
            found = self.media.get(call.path)
            if found is None:
                return httpx.Response(404)
            return httpx.Response(200, content=found[1], headers={"Content-Type": found[0]})
        return httpx.Response(599)

    def calls_to(self, method: str, path: str) -> list[Call]:
        return [c for c in self.calls if c.method == method and c.path == path]

    # ── the API ─────────────────────────────────────────────────────────────

    def _problem(self, status: int, name: str, headers: dict | None = None) -> httpx.Response:
        return httpx.Response(
            status,
            content=json.dumps(self.contract.response_example(name)),
            headers={"Content-Type": "application/problem+json", **(headers or {})},
        )

    def _open(self, call: Call, body: Any, max_age: int = 300) -> httpx.Response:
        etag = '"' + format(hash(json.dumps(body, sort_keys=True)) & 0xFFFFFFFF, "08x") + '"'
        headers = {
            "Cache-Control": f"public, max-age={max_age}",
            "ETag": etag,
            "Vary": "Accept-Language, Authorization",
            "Content-Language": "en",
        }
        if call.headers.get("if-none-match") == etag:
            return httpx.Response(304, headers=headers)
        return httpx.Response(200, json=body, headers=headers)

    def _signed(self, body: Any, status: int = 200, headers: dict | None = None) -> httpx.Response:
        return httpx.Response(
            status, json=body, headers={"Cache-Control": "no-store", **(headers or {})}
        )

    def _api(self, call: Call) -> httpx.Response:
        if self.redirect_to is not None:
            return httpx.Response(302, headers={"Location": self.redirect_to})
        if self.unavailable:
            return self._problem(503, "Unavailable", {"Retry-After": "120"})
        if self.rate_limited is not None:
            return self._problem(
                429,
                "RateLimited",
                {
                    "Retry-After": str(self.rate_limited),
                    "RateLimit-Limit": "60",
                    "RateLimit-Remaining": "0",
                    "RateLimit-Reset": str(self.rate_limited),
                },
            )
        path, method = call.path, call.method
        doc = self.contract
        if path.endswith("/reviews/mine") or path == "/v1/account/company":
            return self._account(call)
        if path.endswith("/support-requests"):
            return self._support(call)
        if path.startswith("/v1/tenant/access"):
            return self._access(call)
        if (method, path) == ("GET", "/v1/meta"):
            return self._open(call, self.meta, 3600)
        if (method, path) == ("GET", "/v1/categories"):
            return self._open(
                call, doc.operation_example("/v1/categories", "get", "200", "categories")
            )
        if (method, path) == ("GET", "/v1/apps"):
            page = doc.operation_example("/v1/apps", "get", "200", "page")
            if "cursor" in call.query:
                page = {"items": page["items"][1:], "nextCursor": None}
            return self._open(call, page)
        if method == "GET" and path.startswith("/v1/apps/"):
            parts = path.removeprefix("/v1/apps/").split("/")
            if "/".join(parts[:2]) != PAID:
                return self._problem(404, "NotFound")
            template = "/v1/apps/{catalogue}/{app}"
            if len(parts) == 2:
                detail = doc.example("AppDetail")
                country = call.query.get("country", [None])[0]
                if country is not None:
                    detail["support"] = [
                        offer
                        for offer in detail["support"]
                        if not offer["countries"] or country in offer["countries"]
                    ]
                return self._open(call, detail)
            if parts[2:] == ["reviews"]:
                page = doc.operation_example(template + "/reviews", "get", "200", "reviews")
                if "companySize" in call.query or "industry" in call.query:
                    # No review of the examples names its author's company.
                    page["items"] = []
                    page["summary"] = {
                        "count": 0,
                        "average": None,
                        "distribution": {str(n): 0 for n in range(1, 6)},
                    }
                return self._open(call, page)
            if parts[2:] == ["reports"]:
                return self._open(
                    call, doc.operation_example(template + "/reports", "get", "200", "reports")
                )
            return self._problem(404, "NotFound")

        # Everything below is a signed-in call.
        if self.token_expired or call.headers.get("authorization") != f"Bearer {STORE_TOKEN}":
            return self._problem(401, "Unauthenticated", {"WWW-Authenticate": "Bearer"})
        if (method, path) == ("GET", "/v1/tenant"):
            return self._signed(self.standing)
        if not self.standing["served"]:
            problem = doc.response_example("Forbidden")
            problem["reason"] = self.standing["refusal"]["reason"]
            return httpx.Response(
                403,
                content=json.dumps(problem),
                headers={"Content-Type": "application/problem+json"},
            )
        if (method, path) == ("GET", "/v1/acquisitions"):
            items = [self._without_credential(a) for a in self.acquisitions.values()]
            return self._signed({"items": items, "nextCursor": None})
        if (method, path) == ("POST", "/v1/acquisitions"):
            return self._acquire(call)
        if path.startswith("/v1/acquisitions/"):
            parts = path.removeprefix("/v1/acquisitions/").split("/")
            acquisition = self.acquisitions.get(parts[0])
            if acquisition is None:
                return self._problem(404, "NotFound")
            if method == "GET" and len(parts) == 1:
                headers = {"Retry-After": "2"} if acquisition["status"] == "pending" else None
                return self._signed(acquisition, headers=headers)
            if method == "POST" and parts[1:] == ["credential"]:
                self.registry_token = ROTATED_TOKEN
                for item in [acquisition["confirmation"], *acquisition["confirmation"]["addons"]]:
                    if "repository" in item:
                        item["repository"]["credential"]["token"] = ROTATED_TOKEN
                return self._signed(acquisition["confirmation"])
        return self._problem(404, "NotFound")

    def _account(self, call: Call) -> httpx.Response:
        """A person's review and company: signed-in calls of their own."""
        if self.token_expired or call.headers.get("authorization") != f"Bearer {STORE_TOKEN}":
            return self._problem(401, "Unauthenticated", {"WWW-Authenticate": "Bearer"})
        method = call.method
        if call.path == "/v1/account/company":
            if method == "PUT":
                self.company = call.json
            if self.company is None:
                return self._problem(404, "NotFound")
            return self._signed(self.company)
        if call.path.removeprefix("/v1/apps/").removesuffix("/reviews/mine") != PAID:
            return self._problem(404, "NotFound")
        if method == "GET":
            if self.my_review is None:
                return self._problem(404, "NotFound")
            return self._signed(self.my_review)
        if method == "DELETE":
            self.my_review = None
            return httpx.Response(204)
        if not self.standing["served"]:
            return self._refused("tenant-refused")
        if self.company is None:
            return self._problem(409, "CompanyMissing")
        if self.meta["reviewing"]["requireAcquisition"] and not any(
            a["coordinate"] == PAID and a["status"] == "confirmed"
            for a in self.acquisitions.values()
        ):
            return self._refused("review-not-acquired")
        body = call.json
        scores = body["scores"]
        given = [v for v in scores.values() if v is not None]
        self.my_review = {
            "id": "rv_MINE",
            "rating": round(sum(given) / len(given)),
            "recommend": body["recommend"],
            "scores": scores,
            "reviewer": {"size": self.company["size"], "industry": self.company["industry"]},
            "mine": True,
            "title": body.get("title"),
            "text": body["text"],
            "author": "A. P.",
            "date": "2026-10-15",
            "language": "en",
            "version": body.get("version"),
        }
        return self._signed(self.my_review)

    def _support(self, call: Call) -> httpx.Response:
        """A request for one of an entry's support offers: received, and kept."""
        if self.token_expired or call.headers.get("authorization") != f"Bearer {STORE_TOKEN}":
            return self._problem(401, "Unauthenticated", {"WWW-Authenticate": "Bearer"})
        coordinate = call.path.removeprefix("/v1/apps/").removesuffix("/support-requests")
        if call.method != "POST" or coordinate != PAID:
            return self._problem(404, "NotFound")
        body = call.json
        offers = {o["id"]: o for o in self.contract.example("AppDetail").get("support", [])}
        offer = offers.get(body.get("offer"))
        if offer is None:
            return self._problem(404, "NotFound")
        if not offer["requestable"]:
            return self._problem(422, "NotRequestable")
        self.support_requests.append(body)
        received = self.contract.operation_example(
            "/v1/apps/{catalogue}/{app}/support-requests", "post", "202", "received"
        )
        return self._signed(received, 202)

    def _access(self, call: Call) -> httpx.Response:
        if self.token_expired or call.headers.get("authorization") != f"Bearer {STORE_TOKEN}":
            return self._problem(401, "Unauthenticated", {"WWW-Authenticate": "Bearer"})
        if (call.method, call.path) == ("GET", "/v1/tenant/access"):
            return self._signed(self.access)
        parts = call.path.removeprefix("/v1/tenant/access/").split("/")
        if call.method != "POST" or len(parts) != 2 or parts[1] not in ("approve", "decline"):
            return self._problem(404, "NotFound")
        if self.access["role"] != "holder":
            return self._problem(403, "Forbidden")
        for account in self.access["accounts"]:
            if account["subject"] == parts[0]:
                account["role"] = "manager" if parts[1] == "approve" else "declined"
                return self._signed(account)
        return self._problem(404, "NotFound")

    def _refused(self, code: str) -> httpx.Response:
        problem = self.contract.response_example("Forbidden")
        problem["code"] = code
        problem["type"] = f"urn:gentian:store:problem:{code}"
        if code == "tenant-refused":
            problem["reason"] = self.standing["refusal"]["reason"]
        else:
            del problem["reason"]
            problem["title"] = "Reviews are of what a tenant acquired"
            problem["detail"] = "No tenant you signed in for has acquired this app."
        return httpx.Response(
            403, content=json.dumps(problem), headers={"Content-Type": "application/problem+json"}
        )

    def _without_credential(self, acquisition: dict) -> dict:
        copy = json.loads(json.dumps(acquisition))
        confirmation = copy.get("confirmation")
        for item in [confirmation, *confirmation["addons"]] if confirmation else []:
            item.get("repository", {}).pop("credential", None)
        return copy

    def _acquire(self, call: Call) -> httpx.Response:
        coordinate = call.json["coordinate"]
        existing = next(
            (
                a
                for a in self.acquisitions.values()
                if a["coordinate"] == coordinate and a["status"] in ("pending", "confirmed")
            ),
            None,
        )
        if existing is not None:
            return self._signed(existing)
        if coordinate == FREE:
            acquisition = self.contract.example("AcquisitionFree")
        elif coordinate == PAID and self.waiting_for:
            acquisition = self.contract.example("AcquisitionPending")
            acquisition.update(
                waitingFor=self.waiting_for, checkoutUrl=None, checkoutExpiresAt=None
            )
        elif coordinate == PAID and self.checkout:
            acquisition = self.contract.example("AcquisitionPending")
            if self.checkout_url is not None:
                acquisition["checkoutUrl"] = self.checkout_url
        elif coordinate == PAID:
            acquisition = self.confirmed()
        elif coordinate == ADDON and self.checkout:
            acquisition = self.addon_acquisition()
            acquisition.update(
                status="pending",
                confirmation=None,
                checkoutUrl=f"{BASE}/checkout/{acquisition['id']}",
                checkoutExpiresAt="2026-10-01T10:14:03Z",
            )
        elif coordinate == ADDON:
            acquisition = self.addon_acquisition()
        else:
            return self._problem(404, "NotFound")
        self.acquisitions[acquisition["id"]] = acquisition
        location = {"Location": f"/v1/acquisitions/{acquisition['id']}"}
        if acquisition["status"] == "pending":
            return self._signed(acquisition, 202, {**location, "Retry-After": "2"})
        return self._signed(acquisition, 201, location)

    def confirmed(self) -> dict:
        """The paid entry's acquisition, confirmed, as this store confirms it."""
        acquisition = self.contract.example("AcquisitionConfirmed")
        confirmation = acquisition["confirmation"]
        if self.confirmed_digest is not None:
            confirmation["digest"] = self.confirmed_digest
        confirmation["addons"] = json.loads(json.dumps(self.confirmed_addons))
        if self.metering is not None:
            confirmation["metering"] = dict(self.metering)
        return acquisition

    def addon_acquisition(self) -> dict:
        """The add-on's acquisition, confirmed: its own build, in the same
        repository as its base's."""
        acquisition = self.contract.example("AcquisitionConfirmed")
        acquisition["id"] = "acq_01JA2P7K"
        acquisition["coordinate"] = ADDON
        confirmation = acquisition["confirmation"]
        confirmation.update(coordinate=ADDON, digest=ADDON_DIGEST, addons=[])
        return acquisition

    def complete_checkout(self) -> None:
        """The person paid, at the store, in the other window."""
        for acquisition_id, acquisition in list(self.acquisitions.items()):
            if acquisition["status"] == "pending":
                self.acquisitions[acquisition_id] = (
                    self.addon_acquisition()
                    if acquisition["coordinate"] == ADDON
                    else self.confirmed()
                )

    # ── the issuer ──────────────────────────────────────────────────────────

    def _issuer(self, call: Call) -> httpx.Response:
        if call.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "code_challenge_methods_supported": ["S256"],
                    "response_types_supported": ["code"],
                },
            )
        if (call.method, call.path) == ("POST", "/token"):
            return httpx.Response(200, json=self.token_answer)
        return httpx.Response(404)
