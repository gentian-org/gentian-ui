"""Support offers (store API 1.3, `support`): the partners that offer support
for an app, shown with it, and a request for one sent on in the person's name.

Reading the offers is part of the open read of an entry. Requesting one is a
signed-in call, relayed as the definition writes it; the store's refusals
reach the bundle with the store's own code.
"""

import asyncio

import pytest
from conftest import ALICE, BOB, make_settings
from fakestore import PAID, STORE_TOKEN
from test_sign_in import sign_in

from app.store.client import get_store

APP = f"/api/v1/store/apps/{PAID}"
REQUESTS = f"{APP}/support-requests"
OFFER = "so_01JA2K7M"


def test_an_entry_carries_its_support_offers_with_the_logo_from_this_apps_origin(api, store):
    detail = api.get(APP, headers=ALICE).json()
    [offer] = detail["support"]
    assert offer["id"] == OFFER
    assert offer["partner"]["name"] == "Example Integrations GmbH"
    assert offer["partner"]["verified"] is True
    assert offer["partner"]["logoUrl"].startswith("/api/v1/media?u=https%3A%2F%2Fmedia.")
    assert offer["countries"] == ["CH", "DE", "AT"] and offer["languages"] == ["de", "en"]
    assert offer["tiers"][0] == {
        "name": "Standard",
        "description": "Answers on working days within one day.",
    }
    assert offer["contactUrl"] == "https://integrations.example/contact"
    assert offer["requestable"] is True
    # Neither the cluster nor the tenant records a country: none is sent.
    assert "country" not in store.calls_to("GET", f"/v1/apps/{PAID}")[-1].query


def test_a_logo_off_the_media_origins_is_not_shown(api, store, contract, monkeypatch):
    detail = contract.example("AppDetail")
    detail["support"][0]["partner"]["logoUrl"] = "https://tracker.example/logo.png"
    original = contract.example
    monkeypatch.setattr(
        contract, "example", lambda name: detail if name == "AppDetail" else original(name)
    )
    answer = api.get(APP, headers=ALICE).json()
    assert answer["support"][0]["partner"]["logoUrl"] is None


def test_an_entry_from_a_store_without_support_has_none(api, store, contract, monkeypatch):
    detail = contract.example("AppDetail")
    del detail["support"]
    original = contract.example
    monkeypatch.setattr(
        contract, "example", lambda name: detail if name == "AppDetail" else original(name)
    )
    assert api.get(APP, headers=ALICE).json()["support"] == []


@pytest.mark.parametrize(
    "broken",
    [
        {"countries": ["Switzerland"]},
        {"contactUrl": "http://integrations.example/contact"},
        {"partner": {"slug": "x", "name": "X" * 121, "verified": True}},
    ],
)
def test_an_offer_that_does_not_fit_is_left_out_and_the_entry_still_shown(
    api, store, contract, monkeypatch, broken
):
    detail = contract.example("AppDetail")
    good = detail["support"][0]
    detail["support"] = [{**good, **broken, "id": "so_BROKEN"}, good]
    original = contract.example
    monkeypatch.setattr(
        contract, "example", lambda name: detail if name == "AppDetail" else original(name)
    )
    answer = api.get(APP, headers=ALICE)
    assert answer.status_code == 200
    assert [o["id"] for o in answer.json()["support"]] == [OFFER]
    # Outside the definition on purpose: the fake noticed, and that is right.
    assert store.violations
    store.violations.clear()


def test_the_client_narrows_the_offers_to_a_country_when_one_is_known(store):
    client = get_store(make_settings())
    covered = asyncio.run(client.app("gentian", "nextcloud-base-ee", "en", country="CH"))
    elsewhere = asyncio.run(client.app("gentian", "nextcloud-base-ee", "en", country="FR"))
    assert [o.id for o in covered.support] == [OFFER]
    assert elsewhere.support == []
    sent = store.calls_to("GET", f"/v1/apps/{PAID}")
    assert [c.query["country"] for c in sent] == [["CH"], ["FR"]]
    # Something that is not a country code is never put into the query.
    asyncio.run(client.app("gentian", "nextcloud-base-ee", "en", country="ch&x=1"))
    assert "country" not in store.calls_to("GET", f"/v1/apps/{PAID}")[-1].query


def test_requesting_support_needs_the_sign_in_to_the_store(api, store):
    answer = api.post(REQUESTS, json={"offer": OFFER, "message": None}, headers=ALICE)
    assert answer.status_code == 403
    assert answer.json()["problem"]["code"] == "store-sign-in-required"
    assert store.calls_to("POST", f"/v1/apps/{PAID}/support-requests") == []


def test_a_request_is_sent_with_the_persons_token_and_received(api, store):
    sign_in(api, store)
    body = {"offer": OFFER, "message": "We would like help with the upgrade."}
    answer = api.post(REQUESTS, json=body, headers=ALICE)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"request": {"id": "sr_01JA2M3Q", "status": "received"}}
    [sent] = store.calls_to("POST", f"/v1/apps/{PAID}/support-requests")
    assert sent.headers["authorization"] == f"Bearer {STORE_TOKEN}"
    assert sent.json == body
    assert store.support_requests == [body]
    # Another person's session has no sign-in, and reaches nothing.
    assert api.post(REQUESTS, json=body, headers=BOB).status_code == 403


def test_a_request_without_a_message_sends_none(api, store):
    sign_in(api, store)
    assert api.post(REQUESTS, json={"offer": OFFER}, headers=ALICE).status_code == 200
    assert store.support_requests == [{"offer": OFFER, "message": None}]


def test_an_offer_that_takes_no_request_is_refused_with_the_stores_code(
    api, store, contract, monkeypatch
):
    sign_in(api, store)
    detail = contract.example("AppDetail")
    detail["support"][0]["requestable"] = False
    original = contract.example
    monkeypatch.setattr(
        contract, "example", lambda name: detail if name == "AppDetail" else original(name)
    )
    answer = api.post(REQUESTS, json={"offer": OFFER}, headers=ALICE)
    assert answer.status_code == 422
    assert answer.json()["problem"]["code"] == "not-requestable"


def test_an_offer_the_store_does_not_have_is_not_found(api, store):
    sign_in(api, store)
    answer = api.post(REQUESTS, json={"offer": "so_NONE"}, headers=ALICE)
    assert answer.status_code == 404
    assert answer.json()["problem"]["code"] == "not-found"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"offer": ""},
        {"offer": "x" * 65},
        {"offer": OFFER, "message": "x" * 2001},
        {"offer": OFFER, "extra": True},
    ],
)
def test_a_body_outside_the_definition_is_not_sent(api, store, body):
    sign_in(api, store)
    answer = api.post(REQUESTS, json=body, headers=ALICE)
    assert answer.status_code == 422
    assert store.calls_to("POST", f"/v1/apps/{PAID}/support-requests") == []
