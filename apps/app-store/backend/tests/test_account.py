"""What a person says at the store in their own name: a review, a company.

Signed-in calls, with the person's store token, relayed as the definition
writes them; the store's refusals reach the bundle with the store's own code,
so the screen can say what is missing. Reading the reviews stays an open
read, filters and all.
"""

import pytest
from conftest import ALICE, BOB
from fakestore import PAID, STORE_TOKEN
from test_sign_in import sign_in

MINE = f"/api/v1/store/apps/{PAID}/reviews/mine"
COMPANY = "/api/v1/store/account/company"
REVIEW = {
    "recommend": True,
    "scores": {"features": 4, "easeOfUse": 5, "easeOfSetup": 3, "support": 4, "value": 4},
    "title": "Does what we need",
    "text": "Running it for forty people since spring.",
    "version": "31.0.4",
}
ACME = {"name": "Acme AG", "size": "10-49", "industry": "education"}


def acquired(store) -> None:
    acquisition = store.confirmed()
    store.acquisitions[acquisition["id"]] = acquisition


def test_the_meta_names_the_sizes_and_industries_and_the_rules_for_reviewing(api, store):
    meta = api.get("/api/v1/store/meta", headers=ALICE).json()
    assert "review-writing" in meta["features"] and "company" in meta["features"]
    assert meta["companySizes"][0] == {"id": "1-9", "name": "1 to 9 people"}
    assert meta["industries"][1] == {"id": "education", "name": "Education", "nace": "P"}
    assert meta["reviewing"] == {"requireAcquisition": True}


def test_a_10_store_names_none_of_it_and_the_meta_says_so(api, store):
    for key in ("companySizes", "industries", "reviewing"):
        del store.meta[key]
    store.meta["features"] = ["reviews"]
    meta = api.get("/api/v1/store/meta", headers=ALICE).json()
    assert meta["companySizes"] == [] and meta["industries"] == []
    assert meta["reviewing"] is None


def test_a_size_or_industry_this_app_does_not_know_is_left_out_of_the_meta(api, store):
    store.meta["companySizes"].append({"id": "5000+", "name": "Huge"})
    meta = api.get("/api/v1/store/meta", headers=ALICE).json()
    assert [c["id"] for c in meta["companySizes"]] == ["1-9", "10-49", "50-249", "250-999", "1000+"]
    # Outside the definition on purpose: a store a step ahead of this app.
    assert len(store.violations) == 1
    store.violations.clear()


def test_the_reviews_are_narrowed_by_company_size_and_industry(api, store):
    answer = api.get(
        f"/api/v1/store/apps/{PAID}/reviews?companySize=10-49&industry=education", headers=ALICE
    )
    assert answer.status_code == 200
    assert answer.json()["summary"]["count"] == 0
    sent = store.calls_to("GET", f"/v1/apps/{PAID}/reviews")[-1]
    assert sent.query["companySize"] == ["10-49"] and sent.query["industry"] == ["education"]
    assert "authorization" not in sent.headers


@pytest.mark.parametrize("query", ["companySize=10-50", "industry=piracy"])
def test_a_filter_outside_the_definition_is_not_sent(api, store, query):
    answer = api.get(f"/api/v1/store/apps/{PAID}/reviews?{query}", headers=ALICE)
    assert answer.status_code == 400
    assert store.calls_to("GET", f"/v1/apps/{PAID}/reviews") == []


def test_writing_needs_the_sign_in_to_the_store(api, store):
    for answer in (
        api.get(MINE, headers=ALICE),
        api.put(MINE, json=REVIEW, headers=ALICE),
        api.delete(MINE, headers=ALICE),
        api.get(COMPANY, headers=ALICE),
        api.put(COMPANY, json=ACME, headers=ALICE),
    ):
        assert answer.status_code == 403
        assert answer.json()["problem"]["code"] == "store-sign-in-required"
    assert not [c for c in store.calls if "mine" in c.path or "company" in c.path]


def test_a_review_is_written_read_and_withdrawn_with_the_persons_token(api, store):
    sign_in(api, store)
    acquired(store)
    assert api.get(MINE, headers=ALICE).json() == {"review": None}
    assert api.put(COMPANY, json=ACME, headers=ALICE).json() == {"company": ACME}

    written = api.put(MINE, json=REVIEW, headers=ALICE)
    assert written.status_code == 200, written.text
    review = written.json()["review"]
    assert review["mine"] is True and review["recommend"] is True
    assert review["scores"] == REVIEW["scores"]
    assert review["reviewer"] == {"size": "10-49", "industry": "education"}
    put = store.calls_to("PUT", f"/v1/apps/{PAID}/reviews/mine")[0]
    assert put.headers["authorization"] == f"Bearer {STORE_TOKEN}"
    assert put.json == REVIEW

    assert api.get(MINE, headers=ALICE).json()["review"]["id"] == review["id"]
    assert api.delete(MINE, headers=ALICE).json() == {"review": None}
    assert api.get(MINE, headers=ALICE).json() == {"review": None}
    # Another person's session has no sign-in, and reaches nothing.
    assert api.get(MINE, headers=BOB).status_code == 403


def test_a_review_without_a_company_is_refused_with_the_stores_code(api, store):
    sign_in(api, store)
    acquired(store)
    answer = api.put(MINE, json=REVIEW, headers=ALICE)
    assert answer.status_code == 409
    assert answer.json()["problem"]["code"] == "company-missing"
    assert api.get(COMPANY, headers=ALICE).json() == {"company": None}


def test_a_review_of_what_no_tenant_acquired_is_refused_with_the_stores_code(api, store):
    sign_in(api, store)
    store.company = ACME
    answer = api.put(MINE, json=REVIEW, headers=ALICE)
    assert answer.status_code == 403
    assert answer.json()["problem"]["code"] == "review-not-acquired"
    assert answer.json()["problem"]["detail"]


def test_a_review_while_the_tenant_is_not_served_is_refused_with_the_stores_code(api, store):
    sign_in(api, store)
    store.standing = store.contract.example("TenantRefused")
    answer = api.put(MINE, json=REVIEW, headers=ALICE)
    assert answer.status_code == 403
    assert answer.json()["problem"]["code"] == "tenant-refused"


@pytest.mark.parametrize(
    "body",
    [
        {**REVIEW, "scores": {**REVIEW["scores"], "features": 6}},
        {**REVIEW, "scores": {**REVIEW["scores"], "features": 0}},
        {**REVIEW, "text": "x" * 5001},
        {**REVIEW, "author": "somebody else"},
        {key: value for key, value in REVIEW.items() if key != "recommend"},
    ],
)
def test_a_review_outside_the_definition_is_not_sent(api, store, body):
    sign_in(api, store)
    assert api.put(MINE, json=body, headers=ALICE).status_code == 422
    assert store.calls_to("PUT", f"/v1/apps/{PAID}/reviews/mine") == []


@pytest.mark.parametrize(
    "body",
    [
        {**ACME, "size": "10-50"},
        {**ACME, "industry": "piracy"},
        {**ACME, "name": ""},
        {**ACME, "tenant": "acme"},
    ],
)
def test_a_company_outside_the_definition_is_not_sent(api, store, body):
    sign_in(api, store)
    assert api.put(COMPANY, json=body, headers=ALICE).status_code == 422
    assert store.calls_to("PUT", "/v1/account/company") == []


def test_a_store_without_review_writing_answers_none(api, store, monkeypatch):
    """A 1.0 store has no such path and answers 404: no review, no company."""
    sign_in(api, store)
    original = store._account
    monkeypatch.setattr(store, "_account", lambda call: store._problem(404, "NotFound"))
    assert api.get(MINE, headers=ALICE).json() == {"review": None}
    assert api.get(COMPANY, headers=ALICE).json() == {"company": None}
    monkeypatch.setattr(store, "_account", original)


def test_a_store_token_that_ended_ends_the_sign_in(api, store):
    sign_in(api, store)
    store.token_expired = True
    answer = api.get(COMPANY, headers=ALICE)
    assert answer.json()["problem"]["code"] == "store-sign-in-required"
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False
