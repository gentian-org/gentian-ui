"""The fake store is the definition's, and so are this app's own models.

Every other test that uses the fake store fails when the fake answers outside
the definition (the `store` fixture). These tests are the other half: every
operation the definition has is asked here at least once, and the examples
the definition is written with are accepted by the models this app reads a
store's answers with.
"""

import asyncio
import json

import pytest
from conftest import make_settings
from fakestore import FREE, PAID, STORE_TOKEN

from app.store import models
from app.store.client import get_store


def test_every_operation_of_the_definition_is_asked_and_answers_within_it(store, contract):
    client = get_store(make_settings())

    async def ask_everything() -> None:
        await client.meta()
        await client.categories("en")
        await client.apps({}, "en")
        await client.app("gentian", "nextcloud-base-ee", "en")
        await client.reviews("gentian", "nextcloud-base-ee", {}, "en")
        await client.reports("gentian", "nextcloud-base-ee", "en")
        await client.tenant(STORE_TOKEN, "s")
        acquisition, _ = await client.acquire(STORE_TOKEN, "s", PAID, None, "key-1")
        await client.acquire(STORE_TOKEN, "s", FREE, None, "key-2")
        await client.acquisitions(STORE_TOKEN, "s")
        await client.acquisition(STORE_TOKEN, "s", acquisition.id)
        await client.replace_credential(STORE_TOKEN, "s", acquisition.id)
        company = models.Company(name="Acme AG", size="10-49", industry="education")
        await client.company(STORE_TOKEN, "s")
        await client.put_company(STORE_TOKEN, "s", company)
        review = models.ReviewRequest.model_validate(review_example(contract))
        await client.my_review(STORE_TOKEN, "s", "gentian", "nextcloud-base-ee")
        await client.put_my_review(STORE_TOKEN, "s", "gentian", "nextcloud-base-ee", review)
        await client.delete_my_review(STORE_TOKEN, "s", "gentian", "nextcloud-base-ee")
        await client.app("gentian", "nextcloud-base-ee", "en", country="CH")
        support = models.SupportRequest.model_validate(support_example(contract))
        await client.request_support(STORE_TOKEN, "s", "gentian", "nextcloud-base-ee", support)
        subject = (await client.access(STORE_TOKEN, "s")).accounts[0].subject
        await client.decide_access(STORE_TOKEN, "s", subject, True)
        await client.decide_access(STORE_TOKEN, "s", subject, False)

    asyncio.run(ask_everything())
    assert store.answered == set(contract.operations())
    assert store.violations == []


def review_example(contract) -> dict:
    """The review the definition writes its request body with."""
    put = contract.document["paths"]["/v1/apps/{catalogue}/{app}/reviews/mine"]["put"]
    return put["requestBody"]["content"]["application/json"]["examples"]["review"]["value"]


def support_example(contract) -> dict:
    """The support request the definition writes its request body with."""
    post = contract.document["paths"]["/v1/apps/{catalogue}/{app}/support-requests"]["post"]
    return post["requestBody"]["content"]["application/json"]["examples"]["request"]["value"]


def test_the_support_request_example_is_what_this_app_sends(contract):
    sent = models.SupportRequest.model_validate(support_example(contract)).model_dump()
    assert sent == support_example(contract)


def test_the_fixture_notices_a_fake_that_left_the_definition(store, contract):
    """The check that guards every other test, shown to bite."""
    broken = contract.example("Meta")
    del broken["issuer"]
    problems = contract.check(
        "GET", "/v1/meta", 200, "application/json", json.dumps(broken).encode()
    )
    assert any("issuer" in p for p in problems)
    assert contract.check("GET", "/v1/nothing", 200, "application/json", b"{}")
    assert contract.check("GET", "/v1/meta", 418, "application/json", b"{}")


@pytest.mark.parametrize(
    ("example", "model"),
    [
        ("Meta", models.Meta),
        ("TenantServed", models.TenantStanding),
        ("TenantRefused", models.TenantStanding),
        ("TenantNotClaimed", models.TenantStanding),
        ("AppDetail", models.AppDetail),
        ("Confirmation", models.Confirmation),
        ("AcquisitionConfirmed", models.Acquisition),
        ("AcquisitionConfirmedNoCredential", models.Acquisition),
        ("AcquisitionFree", models.Acquisition),
        ("AcquisitionPending", models.Acquisition),
    ],
)
def test_the_definitions_examples_are_what_this_app_accepts(contract, example, model):
    model.model_validate(contract.example(example))


def test_the_review_request_example_is_what_this_app_sends(contract):
    sent = models.ReviewRequest.model_validate(review_example(contract)).model_dump()
    problems = contract.check(
        "PUT",
        "/v1/apps/gentian/nextcloud-base-ee/reviews/mine",
        200,
        "application/json",
        json.dumps(
            {**sent, "id": "rv_1", "rating": 4, "author": "A. P.", "date": "2026-10-15"}
        ).encode(),
    )
    assert problems == []


def test_the_cancelled_and_failed_examples_are_accepted(contract):
    for name in ("cancelled", "failed"):
        value = contract.operation_example("/v1/acquisitions/{id}", "get", "200", name)
        assert models.Acquisition.model_validate(value).status == name


def test_the_patterns_this_app_checks_are_the_definitions(contract):
    """An identifier is checked here before it is put into a path. The
    patterns are written out in this app; this is what keeps them the
    definition's."""
    from app.store import patterns

    schemas = contract.document["components"]["schemas"]
    assert schemas["Name"]["pattern"] == patterns.NAME_PATTERN
    assert schemas["Coordinate"]["pattern"] == patterns.COORDINATE_PATTERN
    assert schemas["Digest"]["pattern"] == patterns.DIGEST_PATTERN
    assert schemas["Acquisition"]["properties"]["id"]["pattern"] == patterns.ACQUISITION_ID_PATTERN
    assert (
        contract.document["components"]["parameters"]["AcquisitionId"]["schema"]["pattern"]
        == patterns.ACQUISITION_ID_PATTERN
    )
    assert schemas["Repository"]["properties"]["url"]["pattern"] == patterns.REPOSITORY_URL_PATTERN


def test_a_confirmation_naming_a_git_repository_is_not_one(contract):
    """A git repository of apps is a source of profiles on a cluster: what a
    store may not supply. Such a confirmation does not validate at all, so
    nothing of it is acted on."""
    confirmation = contract.example("Confirmation")
    confirmation["repository"]["type"] = "git"
    with pytest.raises(ValueError):
        models.Confirmation.model_validate(confirmation)


def test_a_confirmed_acquisition_without_its_confirmation_is_not_one(contract):
    acquisition = contract.example("AcquisitionConfirmed")
    acquisition["confirmation"] = None
    with pytest.raises(ValueError):
        models.Acquisition.model_validate(acquisition)


def test_an_entry_of_an_edition_outside_the_four_is_refused(contract):
    """Closed: a client refuses an entry with any other value."""
    page = contract.operation_example("/v1/apps", "get", "200", "page")
    page["items"][0]["edition"] = "xe"
    items, omitted = models.parse_items(models.AppSummary, page["items"])
    assert [i.coordinate for i in items] == ["gentian/xwiki-ce"]
    assert omitted == 1


def test_a_credential_is_not_in_what_a_model_prints(contract):
    acquisition = models.Acquisition.model_validate(contract.example("AcquisitionConfirmed"))
    assert "EXAMPLE-ONLY" not in repr(acquisition)


def test_the_company_sizes_and_industries_this_app_knows_are_the_definitions(contract):
    """Closed enumerations, written out in this app; this keeps them the
    definition's, in its order."""
    from typing import get_args

    schemas = contract.document["components"]["schemas"]
    assert list(get_args(models.CompanySize)) == schemas["CompanySize"]["enum"]
    assert list(get_args(models.Industry)) == schemas["Industry"]["enum"]
