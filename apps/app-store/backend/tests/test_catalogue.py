"""Browsing: the store's open reads, made here and served to the bundle.

The browser never asks a store anything. What this app sends on an open read
is the path and query, the language, and its own name -- nothing of the
tenant, the cluster or the person -- and what it serves is what the
definition says an answer holds, with every image named by this API's own
address or not at all.
"""

import asyncio

import pytest
from conftest import ALICE, HOST, TENANT, make_settings
from fakestore import BASE, MEDIA, PNG, SVG

from app.core.problems import Refusal
from app.store import client as store_client
from app.store.client import get_store

# What an anonymous request may carry. Host, Accept-Encoding and Connection
# are the HTTP client's own and say nothing of who is asking.
ANONYMOUS_HEADERS = {
    "host",
    "accept",
    "accept-encoding",
    "connection",
    "user-agent",
    "accept-language",
    "if-none-match",
}


def test_browsing_needs_no_store_account_and_reaches_the_store_anonymously(api, store):
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False

    listing = api.get("/api/v1/store/apps", headers={**ALICE, "Accept-Language": "de-CH, de;q=0.9"})
    assert listing.status_code == 200
    assert [e["coordinate"] for e in listing.json()["items"]] == [
        "gentian/nextcloud-base-ee",
        "gentian/xwiki-ce",
    ]
    api.get("/api/v1/store/categories", headers=ALICE)
    api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE)
    api.get("/api/v1/store/apps/gentian/nextcloud-base-ee/reviews", headers=ALICE)
    api.get("/api/v1/store/apps/gentian/nextcloud-base-ee/reports", headers=ALICE)

    assert store.calls
    for call in store.calls:
        assert set(call.headers) <= ANONYMOUS_HEADERS, call.headers
        assert call.headers["user-agent"] == "gentian-app-store/0.1.0"
        said = " ".join([call.url, *call.headers.values()]).lower()
        # No tenant, no cluster, no host of the tenant's, nobody's name.
        for identifying in (TENANT, HOST, "cluster-under-test", "alice", "s1"):
            assert identifying not in said
    # The language asked for is passed through, as it was stated.
    assert store.calls_to("GET", "/v1/apps")[0].headers["accept-language"] == "de-CH, de;q=0.9"


def test_signing_in_to_the_store_does_not_put_the_token_on_an_open_read(api, store):
    from test_sign_in import sign_in

    sign_in(api, store)
    store.calls.clear()
    api.get("/api/v1/store/apps", headers=ALICE)
    api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE)
    assert store.calls
    assert all("authorization" not in call.headers for call in store.calls)


def test_a_cookie_a_store_sets_is_never_sent_back(api, store, monkeypatch):
    original = store._api

    def with_cookie(call):
        response = original(call)
        response.headers["Set-Cookie"] = "track=abc; Path=/"
        return response

    monkeypatch.setattr(store, "_api", with_cookie)
    api.get("/api/v1/store/categories", headers=ALICE)
    api.get("/api/v1/store/apps", headers=ALICE)
    api.get("/api/v1/store/apps?q=wiki", headers=ALICE)
    assert all("cookie" not in call.headers for call in store.calls)


def test_filters_and_paging_travel_and_nothing_else_does(api, store):
    answer = api.get(
        "/api/v1/store/apps?category=files&edition=ee&q=%20cloud%20&limit=5&cursor=abc&x=1",
        headers=ALICE,
    )
    assert answer.status_code == 200
    assert store.calls_to("GET", "/v1/apps")[-1].query == {
        "category": ["files"],
        "edition": ["ee"],
        "q": ["cloud"],
        "limit": ["5"],
        "cursor": ["abc"],
    }


@pytest.mark.parametrize(
    "query",
    ["edition=xx", "category=../meta", "category=Files", "limit=0", "limit=101", "cursor=a%20b"],
)
def test_a_filter_that_is_not_the_definitions_never_reaches_the_store(api, store, query):
    answer = api.get(f"/api/v1/store/apps?{query}", headers=ALICE)
    assert answer.status_code in (400, 422)
    assert store.calls_to("GET", "/v1/apps") == []


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/store/apps/gentian/Nextcloud",
        "/api/v1/store/apps/gentian/a..b",
        "/api/v1/store/apps/gen%2Ftian/app",
        "/api/v1/store/apps/gentian/app%3Fx=1/reviews",
        "/api/v1/apps/gentian/-app/state",
    ],
)
def test_a_coordinate_half_that_is_not_a_name_never_reaches_a_path(api, store, cluster, path):
    answer = api.get(path, headers=ALICE)
    assert answer.status_code in (400, 404)
    assert [c for c in store.calls if c.path.startswith("/v1/apps/")] == []
    assert cluster.calls == []


def test_an_open_read_is_kept_for_as_long_as_the_store_said(api, store, clock):
    for _ in range(3):
        assert api.get("/api/v1/store/apps", headers=ALICE).status_code == 200
    assert len(store.calls_to("GET", "/v1/apps")) == 1

    # Past max-age (300 s for a listing): asked again, with the validator.
    clock.advance(301)
    assert api.get("/api/v1/store/apps", headers=ALICE).status_code == 200
    calls = store.calls_to("GET", "/v1/apps")
    assert len(calls) == 2
    assert calls[1].headers["if-none-match"].startswith('"')
    # It was a 304, and the answer served is the one that was held.
    assert len(api.get("/api/v1/store/apps", headers=ALICE).json()["items"]) == 2
    assert len(store.calls_to("GET", "/v1/apps")) == 2


def test_two_languages_are_two_answers(api, store):
    api.get("/api/v1/store/categories", headers={**ALICE, "Accept-Language": "de"})
    api.get("/api/v1/store/categories", headers={**ALICE, "Accept-Language": "fr"})
    api.get("/api/v1/store/categories", headers={**ALICE, "Accept-Language": "de"})
    assert [c.headers["accept-language"] for c in store.calls_to("GET", "/v1/categories")] == [
        "de",
        "fr",
    ]


def test_a_language_header_that_is_not_one_is_not_passed_on(api, store):
    api.get("/api/v1/store/categories", headers={**ALICE, "Accept-Language": "de\tX-Evil: 1"})
    assert "accept-language" not in store.calls_to("GET", "/v1/categories")[0].headers


def test_a_rate_limit_is_honoured_and_nothing_is_sent_until_it_is_over(api, store, clock):
    assert api.get("/api/v1/store/categories", headers=ALICE).status_code == 200  # now cached
    clock.advance(301)
    store.rate_limited = 30

    refused = api.get("/api/v1/store/apps", headers=ALICE)
    assert refused.status_code == 429
    assert refused.headers["retry-after"] == "30"
    assert refused.json()["problem"]["code"] == "rate-limited"
    # The store's own words reach the screen.
    assert refused.json()["problem"]["title"] == "Too many requests"
    sent = len(store.calls)

    # Still shut: nothing leaves, an answer that is held is served, and one
    # that is not says how long to wait.
    clock.advance(10)
    assert api.get("/api/v1/store/categories", headers=ALICE).status_code == 200
    waiting = api.get("/api/v1/store/apps", headers=ALICE)
    assert waiting.status_code == 429
    assert waiting.headers["retry-after"] == "20"
    assert len(store.calls) == sent

    store.rate_limited = None
    clock.advance(21)
    assert api.get("/api/v1/store/apps", headers=ALICE).status_code == 200


def test_remaining_zero_closes_the_gate_until_the_reset(api, store, clock, monkeypatch):
    original = store._api

    def exhausted(call):
        response = original(call)
        response.headers["RateLimit-Remaining"] = "0"
        response.headers["RateLimit-Reset"] = "45"
        return response

    monkeypatch.setattr(store, "_api", exhausted)
    assert api.get("/api/v1/store/categories", headers=ALICE).status_code == 200
    waiting = api.get("/api/v1/store/apps", headers=ALICE)
    assert waiting.status_code == 429
    assert waiting.headers["retry-after"] == "45"
    assert store.calls_to("GET", "/v1/apps") == []


def test_a_store_that_is_not_serving_is_said_to_be_so_in_its_own_words(api, store):
    store.unavailable = True
    answer = api.get("/api/v1/store/apps", headers=ALICE)
    assert answer.status_code == 502
    problem = answer.json()["problem"]
    assert problem["code"] == "store-unavailable"
    assert problem["title"] == "The store is not available"
    assert problem["detail"] == "Maintenance until 06:00 UTC."


def test_a_store_that_cannot_be_reached_is_said_to_be_unreachable(api, store, monkeypatch):
    import httpx

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    monkeypatch.setattr(store_client, "TRANSPORT", httpx.MockTransport(refuse))
    answer = api.get("/api/v1/store/apps", headers=ALICE)
    assert answer.status_code == 502
    assert answer.json()["problem"]["code"] == "store-unreachable"


def test_a_redirect_is_not_followed(api, store):
    store.redirect_to = "https://elsewhere.example/v1/apps"
    answer = api.get("/api/v1/store/apps", headers=ALICE)
    assert answer.status_code == 502
    assert answer.json()["problem"]["code"] == "store-format"
    assert {c.url.split("/v1")[0] for c in store.calls} == {BASE}


def test_an_answer_that_is_not_the_format_is_treated_as_the_store_being_away(
    api, store, monkeypatch
):
    monkeypatch.setattr(store, "meta", {"name": "No issuer, no client"})
    answer = api.get("/api/v1/store/meta", headers=ALICE)
    assert answer.status_code == 502
    assert answer.json()["problem"]["code"] == "store-format"
    store.violations.clear()  # the fake left the definition on purpose


def test_an_answer_larger_than_the_limit_is_not_read(api, store, monkeypatch):
    monkeypatch.setattr(store_client, "MAX_JSON_BYTES", 200)
    answer = api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE)
    assert answer.status_code == 502
    assert answer.json()["problem"]["code"] == "store-format"


def test_an_entry_other_than_the_one_asked_for_is_not_an_answer(api, store, monkeypatch):
    detail = store.contract.example("AppDetail")
    detail["coordinate"] = "gentian/something-else"
    monkeypatch.setattr(store.contract, "example", lambda name: detail)
    answer = api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE)
    assert answer.status_code == 502


def test_the_screen_is_not_told_the_issuer_or_the_client(api, store):
    meta = api.get("/api/v1/store/meta", headers=ALICE).json()
    assert meta["name"] == "Example Store"
    assert "issuer" not in meta and "clientId" not in meta


def test_the_store_only_ever_hears_from_its_own_origin(store):
    """A base address is one origin, and a request to another is refused
    before it is made."""

    async def elsewhere():
        await store_client.fetch(
            "GET", "https://other.example/v1/apps", allowed_origin=BASE, headers={}
        )

    with pytest.raises(Refusal):
        asyncio.run(elsewhere())
    assert store.calls == []


def test_a_store_address_that_is_not_https_is_not_one():
    store_client.reset()
    with pytest.raises(Refusal) as refused:
        get_store(make_settings(STORE_URL="http://store.example"))
    assert refused.value.code == "store-not-configured"


# ── images ──────────────────────────────────────────────────────────────────


def test_an_image_is_named_by_this_apis_own_address(api, store):
    listing = api.get("/api/v1/store/apps", headers=ALICE).json()["items"]
    assert listing[0]["iconUrl"] == (
        "/api/v1/media?u=https%3A%2F%2Fmedia.store.example%2Ficons%2Fnextcloud.png"
    )
    assert listing[1]["iconUrl"] is None
    detail = api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE).json()
    assert detail["screenshots"][0]["url"].startswith("/api/v1/media?u=https%3A%2F%2Fmedia.")
    assert detail["screenshots"][0]["caption"] == "The files view"


def test_an_image_on_an_origin_the_meta_does_not_list_has_no_address(api, store, monkeypatch):
    detail = store.contract.example("AppDetail")
    detail["iconUrl"] = "https://tracker.example/pixel.png"
    detail["screenshots"][0]["url"] = "https://media.store.example.evil.example/a.png"
    monkeypatch.setattr(store.contract, "example", lambda name: detail)
    answer = api.get("/api/v1/store/apps/gentian/nextcloud-base-ee", headers=ALICE).json()
    assert answer["iconUrl"] is None
    assert answer["screenshots"][0]["url"] is None


def test_an_image_is_fetched_here_and_served_as_what_it_is(api, store):
    answer = api.get(f"/api/v1/media?u={MEDIA}/icons/nextcloud.png", headers=ALICE)
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "image/png"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.content == PNG
    sent = next(c for c in store.calls if c.url.startswith(MEDIA))
    # The media host learns that this cluster asked, and nothing of who looks.
    assert set(sent.headers) <= {"host", "accept", "accept-encoding", "connection", "user-agent"}


@pytest.mark.parametrize(
    "url",
    [
        "https://tracker.example/icons/nextcloud.png",  # not a media origin
        "http://media.store.example/icons/nextcloud.png",  # not https
        "https://media.store.example:8443/icons/nextcloud.png",  # another origin
        "https://user@media.store.example/icons/nextcloud.png",
        "https://store.example/v1/acquisitions",  # the API itself is not one
        "file:///etc/passwd",
        "not a url",
    ],
)
def test_an_address_that_is_not_on_a_media_origin_is_not_fetched(api, store, url):
    answer = api.get("/api/v1/media", params={"u": url}, headers=ALICE)
    assert answer.status_code == 404
    assert [c for c in store.calls if c.path != "/v1/meta"] == []


@pytest.mark.parametrize(
    ("declared", "content"),
    [
        ("image/svg+xml", SVG),  # SVG is a document that can carry script
        ("image/png", SVG),  # says PNG, is not
        ("image/jpeg", PNG),  # says JPEG, is PNG
        ("text/html", b"<html></html>"),
        ("image/gif", b"GIF89a" + b"\x00" * 20),
    ],
)
def test_only_png_jpeg_and_webp_are_served_and_only_when_the_bytes_agree(
    api, store, declared, content
):
    store.media["/x"] = (declared, content)
    assert api.get(f"/api/v1/media?u={MEDIA}/x", headers=ALICE).status_code == 404


def test_an_image_larger_than_the_limit_is_not_served(api, store, monkeypatch):
    from app.store import media

    monkeypatch.setattr(media, "MAX_IMAGE_BYTES", 16)
    answer = api.get(f"/api/v1/media?u={MEDIA}/icons/nextcloud.png", headers=ALICE)
    assert answer.status_code == 502


def test_a_media_origin_that_is_not_a_public_host_is_not_asked(api, store, monkeypatch):
    """A store names its media origins itself, and this process then fetches
    from them inside the cluster. One that resolves to a private address is
    not fetched from."""

    async def private(host: str) -> list[str]:
        return ["10.0.0.7"]

    monkeypatch.setattr(store_client, "resolve", private)
    answer = api.get(f"/api/v1/media?u={MEDIA}/icons/nextcloud.png", headers=ALICE)
    assert answer.status_code == 502
    assert [c for c in store.calls if c.url.startswith(MEDIA)] == []


@pytest.mark.parametrize(
    "host",
    ["director.kernel-control.svc", "vault.kernel-secrets.svc.cluster.local", "localhost"],
)
def test_a_cluster_name_is_never_a_media_origin(host):
    with pytest.raises(Refusal):
        asyncio.run(store_client.assert_public(f"https://{host}/x.png"))


def test_every_answer_of_this_api_says_how_it_may_be_used(api, store):
    answer = api.get("/api/v1/store/apps", headers=ALICE)
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in answer.headers["content-security-policy"]


def test_there_is_no_cors(api, store):
    answer = api.get("/api/v1/store/apps", headers={**ALICE, "Origin": "https://evil.example"})
    assert not [h for h in answer.headers if h.lower().startswith("access-control-")]
    preflight = api.options(
        "/api/v1/store/sign-in",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert not [h for h in preflight.headers if h.lower().startswith("access-control-")]
