"""Acquire, declare the repository, set its credential, install.

The sequence the store API's definition gives the App Store app, asked of a
fake store that answers within the definition and of fakes of the director,
the custodian and the usher that answer as the real ones do. What is checked
is what each service was sent, in which order and with whose token, and what
the browser was and was not told.
"""

import json

import pytest
from conftest import ALICE, BOB
from fakestore import ADDON, FREE, PAID, REGISTRY_TOKEN, ROTATED_TOKEN, STORE_TOKEN
from test_sign_in import sign_in

from app.install import sequence
from app.store import oauth

DIGEST = "sha256:3f6c0a1e5b7d9c2a4e6f8091a3b5c7d9e1f20314253647586970a1b2c3d4e5f6"
FREE_DIGEST = "sha256:5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e"
OTHER_DIGEST = "sha256:" + "ab" * 32
ADDON_DIGEST = "sha256:0b1c2d3e4f5a69788796a5f4e3d2c1b00b1c2d3e4f5a69788796a5f4e3d2c1b0"
# The definition's own worked example: tenant acme, this registry.
REPOSITORY = "acme-registry-store-example-app-991ae7e1"
REGISTRY = "oci://registry.store.example/apps"
USERNAME = "tenant-7c1d9e02ab"


class Runner:
    """Drives a sequence the way the screen does: start, then ask for the
    next step until it waits for the person. Keeps every answer it was
    given."""

    def __init__(self, api, clock, who=ALICE) -> None:
        self.api, self.clock, self.who = api, clock, who
        self.answers: list[str] = []
        self.stages: list[str] = []

    def _took(self, answer) -> dict:
        self.answers.append(answer.text)
        assert answer.status_code == 200, answer.text
        view = answer.json()
        self.stages.append(view["stage"])
        return view

    def start(self, coordinate=PAID, **body) -> dict:
        body.setdefault("expectedDigest", DIGEST)
        return self._took(
            self.api.post(f"/api/v1/apps/{coordinate}/operation", json=body, headers=self.who)
        )

    def step(self, coordinate=PAID, **body) -> dict:
        return self._took(
            self.api.post(
                f"/api/v1/apps/{coordinate}/operation/advance", json=body, headers=self.who
            )
        )

    def run(self, view: dict, coordinate=PAID, limit=60) -> dict:
        while not view["waitsForPerson"] and view["stage"] != "checkout":
            limit -= 1
            assert limit > 0, f"the sequence does not come to rest: {self.stages}"
            self.clock.advance(view["waitSeconds"])
            view = self.step(coordinate)
        return view

    def install(self, coordinate=PAID, **body) -> dict:
        return self.run(self.start(coordinate, **body), coordinate)


@pytest.fixture
def runner(api, store, cluster, clock) -> Runner:
    sign_in(api, store)
    return Runner(api, clock)


def test_a_paid_app_is_acquired_declared_credentialed_and_installed_in_that_order(
    runner, store, cluster
):
    view = runner.install(forEveryone=True)
    assert view["stage"] == "done"

    # The store: one acquisition, with an idempotency key, for this entry.
    acquire = store.calls_to("POST", "/v1/acquisitions")
    assert len(acquire) == 1
    assert acquire[0].json == {"coordinate": PAID}
    assert 1 <= len(acquire[0].headers["idempotency-key"]) <= 128
    assert acquire[0].headers["authorization"] == f"Bearer {STORE_TOKEN}"

    # The cluster: declare, then the credential, then the install.
    assert cluster.order() == [
        f"director PUT /v1/tenants/acme/repositories/{REPOSITORY}",
        f"custodian PUT /v1/credentials/repository-{REPOSITORY}",
        "director POST /v1/tenants/acme/apps/nextcloud-base-ee",
    ]
    declare, credential, install = [c for c in cluster.calls if c.method != "GET"]
    assert declare.json == {"role": "apps", "type": "oci", "url": REGISTRY}
    assert credential.json == {"fields": {"username": USERNAME, "password": REGISTRY_TOKEN}}
    assert install.json == {"coordinate": PAID, "digest": DIGEST, "defaultGrant": True}

    # Every one of them with the person's own cluster token, and never with
    # the store's.
    assert {c.bearer for c in cluster.calls} == {"Bearer alice.s1"}

    assert view["install"] == {"status": "installed", "commit": "c0ffee2"}
    assert view["repositories"] == [
        {"name": REPOSITORY, "url": REGISTRY, "declared": "committed", "credential": "set"}
    ]
    assert view["rollout"]["phase"] == "ready"


def test_the_credential_never_reaches_the_browser_and_is_not_kept(runner, store, cluster):
    runner.install()
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE)
    overview = runner.api.get("/api/v1/overview", headers=ALICE)
    for said in [*runner.answers, state.text, overview.text]:
        assert REGISTRY_TOKEN not in said
        assert USERNAME not in said
        assert STORE_TOKEN not in said
    # Handed over once: nothing of it is left in this process.
    operation = sequence.find("alice\ns1", PAID)
    assert REGISTRY_TOKEN not in repr(operation)
    assert all(r.token is None and r.username is None for r in operation.repositories)
    assert operation.confirmation.repository.credential is None


def test_a_free_app_declares_nothing_and_sets_no_credential(runner, store, cluster):
    view = runner.install(FREE, expectedDigest=FREE_DIGEST, forEveryone=False)
    assert view["stage"] == "done"
    assert cluster.order() == ["director POST /v1/tenants/acme/apps/xwiki-ce"]
    assert cluster.of("director", "POST")[0].json == {
        "coordinate": FREE,
        "digest": FREE_DIGEST,
        "defaultGrant": False,
    }
    assert cluster.of("custodian") == []


def test_the_cluster_is_asked_nothing_before_the_store_has_confirmed(runner, store, cluster):
    store.checkout = True
    view = runner.install()
    assert view["stage"] == "checkout"
    assert cluster.order() == []


# ── the checkout ────────────────────────────────────────────────────────────


def test_a_checkout_is_opened_by_the_person_and_its_outcome_is_asked_for(
    runner, store, cluster, clock
):
    store.checkout = True
    view = runner.install()
    assert view["stage"] == "checkout"
    assert view["waitsForPerson"] is False
    # The address is handed to the screen, which opens it in a separate
    # window: it is on an origin the store's meta lists for a checkout.
    assert view["checkout"]["url"] == "https://store.example/checkout/acq_01JA2M8Y"
    # Retry-After is honoured, and never less than two seconds.
    assert view["waitSeconds"] >= 2

    assert runner.step()["stage"] == "checkout"
    assert runner.step()["stage"] == "checkout"
    assert len(store.calls_to("GET", "/v1/acquisitions/acq_01JA2M8Y")) == 2
    assert cluster.order() == []

    store.complete_checkout()
    view = runner.run(runner.step())
    assert view["stage"] == "done"
    assert view["checkout"] is None
    # Acquired once; everything after the 202 was a read.
    assert len(store.calls_to("POST", "/v1/acquisitions")) == 1


@pytest.mark.parametrize(
    "address",
    [
        "https://pay.attacker.example/checkout/acq_01JA2M8Y",
        "https://store.example.attacker.example/checkout",
        "https://store.example:8443/checkout/acq_01JA2M8Y",
    ],
)
def test_a_checkout_on_an_origin_the_meta_does_not_list_is_refused(runner, store, cluster, address):
    store.checkout = True
    store.checkout_url = address
    view = runner.install()
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "checkout-refused"
    # The address is not handed to the browser, in any member of any answer.
    assert view["checkout"] is None
    assert all(address not in said for said in runner.answers)
    assert cluster.order() == []


def test_waiting_for_a_checkout_can_be_stopped(runner, store, cluster):
    store.checkout = True
    runner.install()
    stopped = runner.api.delete(f"/api/v1/apps/{PAID}/operation", headers=ALICE)
    assert stopped.status_code == 200
    state = stopped.json()
    assert state["operation"] is None
    # Nothing was cancelled at the store: the acquisition is still pending
    # there, and that is what the page then shows.
    assert state["stage"] == "checkout"
    assert state["acquisition"]["status"] == "pending"
    gone = runner.api.post(f"/api/v1/apps/{PAID}/operation/advance", json={}, headers=ALICE)
    assert gone.status_code == 404


def test_a_checkout_that_failed_is_said_in_the_stores_words(runner, store, cluster):
    store.checkout = True
    runner.install()
    failed = store.contract.operation_example("/v1/acquisitions/{id}", "get", "200", "failed")
    store.acquisitions[failed["id"]] = failed
    view = runner.step()
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "acquisition-failed"
    assert view["error"]["detail"] == "The payment was declined. Nothing was charged."
    assert cluster.order() == []


# ── the build ───────────────────────────────────────────────────────────────


def test_a_confirmation_for_another_build_is_put_before_the_person_first(runner, store, cluster):
    """A store can show one build and confirm another. Nothing is sent to the
    cluster until the person has seen the digest that would be."""
    store.confirmed_digest = OTHER_DIGEST
    view = runner.install()
    assert view["stage"] == "confirm-build"
    assert view["build"]["digest"] == OTHER_DIGEST
    assert view["expectedDigest"] == DIGEST
    assert cluster.order() == []

    # Confirming the digest that was shown at the start confirms nothing.
    assert runner.step(confirmDigest=DIGEST)["stage"] == "confirm-build"
    assert cluster.order() == []

    view = runner.run(runner.step(confirmDigest=OTHER_DIGEST))
    assert view["stage"] == "done"
    assert cluster.of("director", "POST")[0].json["digest"] == OTHER_DIGEST


def test_a_confirmation_for_another_entry_is_not_acted_on(runner, store, cluster, monkeypatch):
    confirmed = store.confirmed

    def another():
        acquisition = confirmed()
        acquisition["confirmation"]["coordinate"] = "gentian/something-else"
        return acquisition

    monkeypatch.setattr(store, "confirmed", another)
    view = runner.install()
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "store-format"
    assert cluster.order() == []


def test_a_confirmation_that_does_not_validate_is_not_acted_on_in_part(
    runner, store, cluster, monkeypatch
):
    confirmed = store.confirmed

    def with_a_git_addon():
        acquisition = confirmed()
        acquisition["confirmation"]["addons"] = [
            {
                "coordinate": "gentian/nextcloud-office-ee",
                "version": "1",
                "digest": ADDON_DIGEST,
                "repository": {"type": "git", "url": "oci://git.example/profiles"},
            }
        ]
        return acquisition

    monkeypatch.setattr(store, "confirmed", with_a_git_addon)
    view = runner.install()
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "store-format"
    # Not the base app either: nothing of it was sent anywhere.
    assert cluster.calls == []
    store.violations.clear()  # the fake left the definition on purpose


# ── the repository ──────────────────────────────────────────────────────────


def test_a_dangerous_declaration_is_never_confirmed_by_this_app(runner, store, cluster):
    """The computed name is one the tenant holds for another address. The
    director asks for the name to be repeated; this app shows what it said
    and sends `confirm` only with what the person typed."""
    cluster.repositories[REPOSITORY] = "oci://registry.elsewhere.example/apps"
    cluster.synced.add(REPOSITORY)

    view = runner.install()
    assert view["stage"] == "confirm-repository"
    assert view["waitsForPerson"] is True
    assert view["confirmRepository"]["name"] == REPOSITORY
    assert "re-pointing it changes where" in view["confirmRepository"]["text"]
    assert view["confirmRepository"]["confirmWith"] == REPOSITORY
    declarations = cluster.of("director", "PUT")
    assert len(declarations) == 1
    assert "confirm" not in declarations[0].json

    # Asking for the next step without the person's word sends nothing.
    assert runner.step()["stage"] == "confirm-repository"
    assert runner.step(retry=True)["stage"] == "confirm-repository"
    assert len(cluster.of("director", "PUT")) == 1
    assert cluster.of("custodian") == []

    # What the person typed is what travels -- a wrong name included, which
    # the director refuses again.
    assert runner.step(confirmRepository="something-else")["stage"] == "confirm-repository"
    assert cluster.of("director", "PUT")[-1].json["confirm"] == "something-else"
    assert cluster.repositories[REPOSITORY] == "oci://registry.elsewhere.example/apps"

    view = runner.run(runner.step(confirmRepository=REPOSITORY))
    assert view["stage"] == "done"
    assert cluster.of("director", "PUT")[-1].json == {
        "role": "apps",
        "type": "oci",
        "url": REGISTRY,
        "confirm": REPOSITORY,
    }
    assert cluster.repositories[REPOSITORY] == REGISTRY


def test_a_repository_already_declared_is_declared_again_harmlessly(runner, store, cluster):
    cluster.repositories[REPOSITORY] = REGISTRY
    cluster.synced.add(REPOSITORY)
    view = runner.install()
    assert view["stage"] == "done"
    assert view["repositories"][0]["declared"] == "unchanged"


def test_one_repository_named_by_the_app_and_its_addon_is_declared_once(runner, store, cluster):
    store.confirmed_addons = store.contract.example("Confirmation")["addons"]
    view = runner.install()
    assert view["stage"] == "done"
    assert len(cluster.of("director", "PUT")) == 2  # the repository, and the add-ons
    assert len(cluster.of("custodian", "PUT")) == 1


# ── the credential ──────────────────────────────────────────────────────────


def test_the_custodian_is_asked_again_until_the_cluster_has_the_repository(
    runner, store, cluster, clock
):
    cluster.sync_after = 3
    view = runner.start()
    waits = []
    while view["stage"] != "install":
        if view["stage"] == "credential" and view["waitSeconds"]:
            # Said on the screen while it waits.
            assert view["repositories"][0]["credential"] == "waiting"
            waits.append(view["waitSeconds"])
        clock.advance(view["waitSeconds"])
        view = runner.step()
    # Backed off, and bounded.
    assert waits == [2, 4, 8]
    assert len(cluster.of("custodian", "PUT")) == 4
    assert runner.run(view)["stage"] == "done"
    # The install waited for the credential.
    assert cluster.order()[-1] == "director POST /v1/tenants/acme/apps/nextcloud-base-ee"
    assert cluster.credentials[REPOSITORY] == {"username": USERNAME, "password": REGISTRY_TOKEN}


def test_a_repository_that_does_not_arrive_stops_the_sequence_and_continues_from_there(
    runner, store, cluster, clock
):
    cluster.sync_after = 10**6
    view = runner.install()
    assert view["stage"] == "credential-timeout"
    assert view["waitsForPerson"] is True
    assert view["error"]["source"] == "custodian"
    assert view["error"]["status"] == 404
    asked = len(cluster.of("custodian", "PUT"))
    # Bounded: about five minutes of asking, not for ever.
    assert 10 < asked < 60
    assert cluster.of("director", "POST") == []

    # Asking for the next step without "continue" does nothing.
    assert runner.step()["stage"] == "credential-timeout"
    assert len(cluster.of("custodian", "PUT")) == asked

    # The cluster has caught up. Continuing resumes at the credential: the
    # app is not acquired again and the repository is not declared again.
    cluster.sync_after = 0
    view = runner.run(runner.step(**{"continue": True}))
    assert view["stage"] == "done"
    assert len(store.calls_to("POST", "/v1/acquisitions")) == 1
    assert len(cluster.of("director", "PUT")) == 1
    assert cluster.credentials[REPOSITORY]["password"] == REGISTRY_TOKEN


def test_a_credential_the_custodian_refuses_is_said_in_its_words(
    runner, store, cluster, monkeypatch
):
    monkeypatch.setattr(
        cluster,
        "_custodian",
        lambda *a: (
            422,
            {"error": "validation failed against the target endpoint: 401 from the registry"},
        ),
    )
    view = runner.install()
    assert view["stage"] == "failed"
    assert view["failedStage"] == "credential"
    assert view["error"]["source"] == "custodian"
    assert "401 from the registry" in view["error"]["detail"]
    assert cluster.of("director", "POST") == []


# ── the install ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("status", "text"),
    [
        (
            422,
            (
                '"gentian" is not a catalogue source of this cluster, so nothing can be fetched '
                "from it or verified; nothing was installed. "
                "This cluster declares no catalogue source."
            ),
        ),
        (409, "the platform tenant takes no apps"),
        (
            403,
            "installing an app for everyone gives people access to it, which needs can_grant",
        ),
        (
            502,
            (
                "the catalogue source served a bundle for gentian/nextcloud-base-ee that is not "
                "this entry; nothing was installed"
            ),
        ),
    ],
)
def test_the_directors_refusal_is_passed_through_as_it_was_said(
    runner, store, cluster, status, text
):
    cluster.install_refusal = (status, text)
    view = runner.install(forEveryone=True)
    assert view["stage"] == "failed"
    assert view["failedStage"] == "install"
    assert view["error"] == {
        "source": "director",
        "code": f"http-{status}",
        "status": status,
        "detail": text,
    }

    # The step can be asked again, and only that step is.
    cluster.install_refusal = None
    writes = len(cluster.order())
    view = runner.run(runner.step(retry=True))
    assert view["stage"] == "done"
    assert cluster.order()[writes:] == ["director POST /v1/tenants/acme/apps/nextcloud-base-ee"]
    assert len(store.calls_to("POST", "/v1/acquisitions")) == 1


def test_addons_are_pinned_after_the_app_and_nothing_active_is_switched_off(runner, store, cluster):
    store.confirmed_addons = store.contract.example("Confirmation")["addons"]
    cluster.apps["nextcloud-base-ee"] = {
        "profile": "nextcloud-base-ee",
        "addons": ["nextcloud-talk-ee", "nextcloud-office-ee"],
    }
    view = runner.install()
    assert view["stage"] == "done"
    assert cluster.order()[-2:] == [
        "director POST /v1/tenants/acme/apps/nextcloud-base-ee",
        "director PUT /v1/tenants/acme/apps/nextcloud-base-ee/addons",
    ]
    # The list is replaced whole: what was active stays, by name, and the
    # acquisition's add-on travels as the build the store confirmed.
    assert cluster.calls[-2].json == {
        "addons": [
            "nextcloud-talk-ee",
            {"coordinate": "gentian/nextcloud-office-ee", "digest": ADDON_DIGEST},
        ]
    }
    assert view["addons"] == {"status": "updated", "commit": "c0ffee3"}


# ── an add-on, in an installed app ──────────────────────────────────────────


def install_addon(runner, **body) -> dict:
    body.setdefault("expectedDigest", ADDON_DIGEST)
    body.setdefault("addonOf", PAID)
    return runner.install(ADDON, **body)


def test_an_addon_is_acquired_and_pinned_inside_its_app_not_installed_apart(runner, store, cluster):
    runner.install()
    cluster.apps["nextcloud-base-ee"]["addons"] = ["nextcloud-talk-ee"]
    cluster.calls.clear()

    view = install_addon(runner)
    assert view["stage"] == "done"
    assert view["addonOf"] == "nextcloud-base-ee"
    # Acquired as an entry of its own, at the store.
    assert store.calls_to("POST", "/v1/acquisitions")[-1].json == {"coordinate": ADDON}
    # Its repository is the base's: declared again harmlessly, its credential
    # set; then the base's list, with what was active kept by name. Nothing
    # is installed under the add-on's own name.
    assert cluster.order() == [
        f"director PUT /v1/tenants/acme/repositories/{REPOSITORY}",
        f"custodian PUT /v1/credentials/repository-{REPOSITORY}",
        "director PUT /v1/tenants/acme/apps/nextcloud-base-ee/addons",
    ]
    assert cluster.of("director", "PUT")[-1].json == {
        "addons": ["nextcloud-talk-ee", {"coordinate": ADDON, "digest": ADDON_DIGEST}]
    }
    assert view["addons"] == {"status": "updated", "commit": "c0ffee3"}
    # The rollout it watched is the base's, and the tile is the base's too.
    assert view["rollout"]["phase"] == "ready"
    assert view["tile"] is None
    # A page loaded again finds the add-on's sequence beside its app.
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert [op["coordinate"] for op in state["addonOperations"]] == [ADDON]
    assert state["installed"]["addons"] == ["nextcloud-talk-ee", "nextcloud-office-ee"]


def test_a_paid_addon_opens_its_own_checkout(runner, store, cluster):
    runner.install()
    store.checkout = True
    cluster.calls.clear()
    view = install_addon(runner)
    assert view["stage"] == "checkout"
    assert view["checkout"]["url"] == "https://store.example/checkout/acq_01JA2P7K"
    assert cluster.order() == []
    store.complete_checkout()
    view = runner.run(runner.step(ADDON), ADDON)
    assert view["stage"] == "done"
    assert cluster.order()[-1] == "director PUT /v1/tenants/acme/apps/nextcloud-base-ee/addons"


def test_an_addon_waits_on_its_apps_approvals(runner, store, cluster):
    runner.install()
    cluster.states["nextcloud-base-ee"] = {
        "profile": "nextcloud-base-ee",
        "name": "nextcloud-base-ee",
        "phase": "installing",
        "ready": False,
        "pendingPrivileges": ["egress/smtp"],
        "pendingPrivilegeApprovals": [
            {"privilege": "egress/smtp", "approvedBy": "perimeter-approver"}
        ],
    }
    view = runner.start(ADDON, expectedDigest=ADDON_DIGEST, addonOf=PAID)
    while view["stage"] not in ("approvals", "failed", "done"):
        view = runner.step(ADDON)
    # The same step an app's own install stands at: the base's requests,
    # answered here, the add-on's sequence waiting until none is pending.
    assert view["stage"] == "approvals"
    assert view["rollout"]["pendingPrivilegeApprovals"][0]["privilege"] == "egress/smtp"


def test_an_addons_own_requests_are_shown_and_approved_under_its_name(runner, store, cluster):
    runner.install()
    cluster.states["nextcloud-base-ee"] = {
        "profile": "nextcloud-base-ee",
        "name": "nextcloud-base-ee",
        "phase": "ready",
        "ready": True,
        "addons": [
            {
                "profile": "nextcloud-office-ee",
                "name": "nextcloud-office-ee",
                "phase": "installing",
                "ready": False,
                "pendingPrivileges": ["egress/wopi"],
                "pendingPrivilegeApprovals": [
                    {"privilege": "egress/wopi", "approvedBy": "perimeter-approver"}
                ],
            },
            # Another add-on's request is not this install's to wait on.
            {
                "profile": "nextcloud-talk-ee",
                "name": "nextcloud-talk-ee",
                "phase": "installing",
                "ready": False,
                "pendingPrivilegeApprovals": [
                    {"privilege": "egress/turn", "approvedBy": "perimeter-approver"}
                ],
            },
        ],
    }
    view = runner.start(ADDON, expectedDigest=ADDON_DIGEST, addonOf=PAID)
    while view["stage"] not in ("approvals", "failed", "done"):
        view = runner.step(ADDON)
    # The base is up; the add-on waits on its own request, which says whose it is.
    assert view["stage"] == "approvals"
    assert [(a["privilege"], a["addon"]) for a in view["rollout"]["pendingPrivilegeApprovals"]] == [
        ("egress/wopi", "nextcloud-office-ee")
    ]
    # Approved under the add-on's own Component, not the app's.
    answer = runner.api.post(
        f"/api/v1/apps/{ADDON}/privileges/egress/wopi/approve",
        json={"reason": "the office server is ours"},
        headers=ALICE,
    )
    assert answer.status_code == 200, answer.text
    assert cluster.approved == [
        ("nextcloud-office-ee/egress/wopi", {"reason": "the office server is ours"})
    ]
    cluster.states["nextcloud-base-ee"]["addons"][0] = {
        "profile": "nextcloud-office-ee",
        "name": "nextcloud-office-ee",
        "phase": "ready",
        "ready": True,
    }
    assert runner.step(ADDON)["stage"] == "done"


def test_an_addon_needs_its_app_installed(runner, store, cluster):
    view = install_addon(runner)
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "not-installed"
    assert "director PUT /v1/tenants/acme/apps/nextcloud-base-ee/addons" not in cluster.order()


def test_an_addon_is_not_updated_from_here(runner):
    answer = runner.api.post(
        f"/api/v1/apps/{ADDON}/operation",
        json={
            "mode": "update",
            "expectedDigest": ADDON_DIGEST,
            "acquisitionId": "acq_01JA2P7K",
            "addonOf": PAID,
        },
        headers=ALICE,
    )
    assert answer.status_code == 400


def test_an_addon_is_removed_and_the_rest_stay_by_name(runner, store, cluster):
    runner.install()
    cluster.apps["nextcloud-base-ee"]["addons"] = ["nextcloud-talk-ee", "nextcloud-office-ee"]
    cluster.calls.clear()
    answer = runner.api.delete(f"/api/v1/apps/{PAID}/addons/{ADDON}", headers=ALICE)
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"status": "updated", "commit": "c0ffee3"}
    assert cluster.order() == ["director PUT /v1/tenants/acme/apps/nextcloud-base-ee/addons"]
    assert cluster.calls[-1].json == {"addons": ["nextcloud-talk-ee"]}
    assert cluster.calls[-1].bearer == "Bearer alice.s1"

    # Removing one that is not on writes nothing.
    cluster.calls.clear()
    answer = runner.api.delete(f"/api/v1/apps/{PAID}/addons/{ADDON}", headers=ALICE)
    assert answer.json() == {"status": "no_change", "commit": None}
    assert cluster.order() == []


def test_an_update_moves_the_pin_and_says_nothing_of_who_the_app_is_for(runner, store, cluster):
    runner.install(forEveryone=True)
    acquisition = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()["acquisition"]
    store.acquisitions[acquisition["id"]]["confirmation"]["digest"] = OTHER_DIGEST
    store.acquisitions[acquisition["id"]]["confirmation"]["version"] = "31.0.5"
    cluster.calls.clear()

    view = runner.install(
        mode="update",
        acquisitionId=acquisition["id"],
        version="31.0.5",
        expectedDigest=OTHER_DIGEST,
    )
    assert view["stage"] == "done"
    # The pin, and only the pin: no repository, no credential, and no
    # defaultGrant -- absent leaves who may open the app as it is.
    assert cluster.order() == ["director POST /v1/tenants/acme/apps/nextcloud-base-ee"]
    assert cluster.of("director", "POST")[0].json == {"coordinate": PAID, "digest": OTHER_DIGEST}
    assert store.calls_to("GET", f"/v1/acquisitions/{acquisition['id']}")[-1].query == {
        "version": ["31.0.5"]
    }
    assert len(store.calls_to("POST", "/v1/acquisitions")) == 1
    assert cluster.apps["nextcloud-base-ee"]["defaultGrant"] is True


# ── the rollout ─────────────────────────────────────────────────────────────


def test_progress_is_the_clusters_own_until_the_app_runs(runner, store, cluster, clock):
    cluster.ready_on_install = False
    view = runner.start()
    while view["stage"] != "rollout":
        clock.advance(view["waitSeconds"])
        view = runner.step()
    # Committed, and the cluster has not picked it up: nothing to show yet,
    # and the usher is asked again in a while.
    view = runner.step()
    assert view["stage"] == "rollout"
    assert view["rollout"] is None
    assert view["waitSeconds"] == 5

    cluster.states["nextcloud-base-ee"] = {
        "profile": "nextcloud-base-ee",
        "phase": "installing",
        "ready": False,
        "message": "waiting for the database",
        "pendingPrivileges": ["egress/smtp"],
    }
    view = runner.step()
    assert view["stage"] == "rollout"
    assert view["rollout"]["message"] == "waiting for the database"
    assert view["rollout"]["pendingPrivileges"] == ["egress/smtp"]

    cluster.states["nextcloud-base-ee"] = {
        "profile": "nextcloud-base-ee",
        "phase": "failing",
        "ready": False,
        "failure": f"pull refused: set the credential of repository {REPOSITORY} again",
    }
    view = runner.step()
    assert view["stage"] == "failing"
    assert view["waitsForPerson"] is True
    assert REPOSITORY in view["rollout"]["failure"]

    # A failing workload may recover: looking again is asking again.
    cluster.states["nextcloud-base-ee"] = {"profile": "nextcloud-base-ee", "phase": "ready"}
    assert runner.step()["stage"] == "done"


# ── the approvals ───────────────────────────────────────────────────────────

APP = "nextcloud-base-ee"
WAITING = {
    "profile": APP,
    "name": APP,
    "phase": "installing",
    "ready": False,
    "message": "waiting for approval of egress/smtp, podSecurity/run-as-root",
    "pendingPrivileges": ["egress/smtp", "podSecurity/run-as-root"],
    "pendingPrivilegeApprovals": [
        {"privilege": "egress/smtp", "approvedBy": "perimeter-approver", "reason": "sends mail through the relay"},
        {"privilege": "podSecurity/run-as-root", "approvedBy": "security-officer", "reason": "writes its cache as root"},
    ],
}


def to_rollout(runner, cluster, clock) -> dict:
    cluster.ready_on_install = False
    view = runner.start()
    while view["stage"] != "rollout":
        clock.advance(view["waitSeconds"])
        view = runner.step()
    return view


def test_an_app_that_waits_on_a_person_stands_at_approvals_until_none_is_pending(
    runner, store, cluster, clock
):
    to_rollout(runner, cluster, clock)
    cluster.states[APP] = dict(WAITING)
    view = runner.step()
    # Not a stop: the page keeps asking, and shows whom each request waits on.
    assert view["stage"] == "approvals"
    assert view["waitsForPerson"] is False and view["waitSeconds"] == 5
    assert view["rollout"]["name"] == APP
    assert [(p["privilege"], p["approvedBy"], p["reason"]) for p in view["rollout"]["pendingPrivilegeApprovals"]] == [
        ("egress/smtp", "perimeter-approver", "sends mail through the relay"),
        ("podSecurity/run-as-root", "security-officer", "writes its cache as root"),
    ]

    # The tenant's own: approved here, with the person's reason, naming the
    # Component the cluster named.
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/privileges/egress/smtp/approve",
        json={"reason": "the relay is ours and rate-limited"},
        headers=ALICE,
    )
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"status": "updated", "commit": "c0ffee5"}
    assert cluster.approved == [(f"{APP}/egress/smtp", {"reason": "the relay is ours and rate-limited"})]
    assert cluster.of("director", "PUT")[-1].bearer == "Bearer alice.s1"

    # The security officer's: asked for, with a note.
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/privileges/podSecurity/run-as-root/request",
        json={"note": "needed for the pilot"},
        headers=ALICE,
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "requested"
    assert answer.json()["request"]["requestedBy"] == "alice@acme.example"
    assert cluster.requested == [(APP, {"privilege": "podSecurity/run-as-root", "note": "needed for the pilot"})]

    # The cluster takes the approval in and shows the request: still waiting,
    # on the security officer alone now.
    cluster.states[APP] = {
        **WAITING,
        "pendingPrivileges": ["podSecurity/run-as-root"],
        "pendingPrivilegeApprovals": [
            {
                "privilege": "podSecurity/run-as-root",
                "approvedBy": "security-officer",
                "reason": "writes its cache as root",
                "requestedBy": "alice@acme.example",
                "requestedAt": "2026-10-21T09:12:00Z",
                "note": "needed for the pilot",
            }
        ],
    }
    view = runner.step()
    assert view["stage"] == "approvals"
    assert view["rollout"]["pendingPrivilegeApprovals"][0]["requestedBy"] == "alice@acme.example"

    # Approved at the platform console: nothing is pending, the rollout goes on.
    cluster.states[APP] = {"profile": APP, "name": APP, "phase": "installing", "ready": False, "message": "deploying"}
    view = runner.step()
    assert view["stage"] == "rollout" and view["rollout"]["pendingPrivilegeApprovals"] == []
    cluster.states[APP] = {"profile": APP, "name": APP, "phase": "ready", "ready": True}
    assert runner.step()["stage"] == "done"


def test_a_grant_that_ran_out_and_an_approver_this_app_does_not_know(runner, store, cluster, clock):
    to_rollout(runner, cluster, clock)
    cluster.states[APP] = {
        **WAITING,
        "pendingPrivilegeApprovals": [
            {"privilege": "podSecurity/run-as-root", "approvedBy": "security-officer", "expiredAt": "2026-10-20T00:00:00Z"},
            {"privilege": "egress/smtp", "approvedBy": "tenant"},
            {"approvedBy": "perimeter-approver"},
        ],
    }
    view = runner.step()
    assert view["stage"] == "approvals"
    approvals = view["rollout"]["pendingPrivilegeApprovals"]
    assert [p["privilege"] for p in approvals] == ["podSecurity/run-as-root"]
    assert approvals[0]["expiredAt"] == "2026-10-20T00:00:00Z"


def test_a_declined_request_is_shown_as_such_and_can_be_asked_for_again(runner, store, cluster, clock):
    to_rollout(runner, cluster, clock)
    cluster.states[APP] = {
        **WAITING,
        "pendingPrivileges": ["podSecurity/run-as-root"],
        "pendingPrivilegeApprovals": [
            {
                "privilege": "podSecurity/run-as-root",
                "approvedBy": "security-officer",
                "reason": "writes its cache as root",
                "requestedBy": "alice@acme.example",
                "requestedAt": "2026-10-21T09:12:00Z",
                "declinedBy": "sam@example.com",
                "declinedAt": "2026-10-21T10:00:00Z",
                "declineReason": "no root on shared nodes; use the rootless image",
            }
        ],
    }
    view = runner.step()
    # Still the approvals step: a decline installs nothing, and the no is
    # shown with who said it and why.
    assert view["stage"] == "approvals"
    approval = view["rollout"]["pendingPrivilegeApprovals"][0]
    assert (approval["declinedBy"], approval["declinedAt"], approval["declineReason"]) == (
        "sam@example.com",
        "2026-10-21T10:00:00Z",
        "no root on shared nodes; use the rootless image",
    )
    # Asking again is the same request route; the operator treats it as new.
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/privileges/podSecurity/run-as-root/request",
        json={"note": "now with the rootless image"},
        headers=ALICE,
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "requested"
    assert cluster.requested == [(APP, {"privilege": "podSecurity/run-as-root", "note": "now with the rootless image"})]


def test_a_reload_shows_the_approvals_without_an_operation(runner, store, cluster, clock):
    to_rollout(runner, cluster, clock)
    cluster.states[APP] = dict(WAITING)
    runner.step()
    sequence.reset()
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert state["operation"] is None and state["stage"] == "installing"
    assert [p["approvedBy"] for p in state["state"]["pendingPrivilegeApprovals"]] == ["perimeter-approver", "security-officer"]


def test_the_directors_refusal_of_an_approval_is_said_in_its_words(runner, store, cluster, clock):
    to_rollout(runner, cluster, clock)
    cluster.states[APP] = dict(WAITING)
    runner.step()
    cluster.privilege_refusal = (403, "a podSecurity privilege weakens what protects the node; approving one is the security officer's")
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/privileges/podSecurity/run-as-root/approve",
        json={"reason": "we would like it anyway"},
        headers=ALICE,
    )
    assert answer.status_code == 403
    problem = answer.json()["problem"]
    assert problem["source"] == "director" and "security officer" in problem["detail"]
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/privileges/podSecurity/run-as-root/request", json={}, headers=ALICE
    )
    assert answer.status_code == 403


@pytest.mark.parametrize(
    "path, body",
    [
        ("privileges/egress/smtp/approve", {"reason": "short"}),
        ("privileges/egress/smtp/approve", {"reason": "long enough indeed", "install": "x"}),
        ("privileges/hostNetwork/x/approve", {"reason": "long enough indeed"}),
        ("privileges/egress/Not%20A%20Name/approve", {"reason": "long enough indeed"}),
        ("privileges/hostNetwork/x/request", {}),
        ("privileges/egress/smtp/request", {"reason": "x"}),
    ],
)
def test_an_approval_that_is_not_well_formed_never_reaches_the_director(runner, cluster, path, body):
    answer = runner.api.post(f"/api/v1/apps/{PAID}/{path}", json=body, headers=ALICE)
    assert answer.status_code in (400, 422), answer.text
    assert cluster.approved == [] and cluster.requested == []


# ── resuming ────────────────────────────────────────────────────────────────


def test_a_reload_in_the_middle_shows_where_the_sequence_stands(runner, store, cluster):
    cluster.sync_after = 10**6
    runner.install()
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert state["stage"] == "acquired"
    assert state["acquisition"]["status"] == "confirmed"
    assert state["acquisition"]["repositories"] == [{"name": REPOSITORY, "url": REGISTRY}]
    assert state["installed"] is None
    assert state["operation"]["stage"] == "credential-timeout"
    # Another person's page of the same entry is not shown this one's place.
    assert runner.api.get(f"/api/v1/apps/{PAID}/state", headers=BOB).json()["operation"] is None


def test_after_an_interruption_the_sequence_resumes_and_nothing_is_acquired_again(
    runner, store, cluster
):
    """This process restarted in the middle: everything it remembered of the
    sequence is gone, the credential included. Where things stand is derived
    from the store and the cluster, and continuing reads the acquisition
    rather than acquiring again."""
    cluster.sync_after = 10**6
    assert runner.install()["stage"] == "credential-timeout"

    sequence.reset()
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert state["operation"] is None
    assert state["stage"] == "acquired"
    acquisition_id = state["acquisition"]["id"]

    cluster.sync_after = 0
    view = runner.install(acquisitionId=acquisition_id, forEveryone=True)
    assert view["stage"] == "done"
    assert len(store.calls_to("POST", "/v1/acquisitions")) == 1
    assert store.calls_to("GET", f"/v1/acquisitions/{acquisition_id}")
    # Declared again, which the director answers as unchanged.
    assert view["repositories"][0]["declared"] == "unchanged"
    assert cluster.credentials[REPOSITORY]["password"] == REGISTRY_TOKEN
    assert cluster.of("director", "POST")[0].json["defaultGrant"] is True

    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert state["stage"] == "ready"
    assert state["installed"] == {
        "profile": "nextcloud-base-ee",
        "digest": DIGEST,
        "forEveryone": True,
        "addons": [],
        # How the app moves to newer builds is the director's report's to
        # say, and this cluster answers none: unknown, so nothing may move.
        "updateMode": None,
    }
    assert state["mayUpdate"] is False


def test_installing_twice_changes_nothing_the_second_time(runner, store, cluster):
    runner.install()
    view = runner.install()
    assert view["stage"] == "done"
    assert view["install"]["status"] == "already_installed"
    assert view["repositories"][0]["declared"] == "unchanged"


# ── the store's side ────────────────────────────────────────────────────────


def test_nothing_is_started_without_a_store_sign_in(api, store, cluster):
    answer = api.post(
        f"/api/v1/apps/{PAID}/operation", json={"expectedDigest": DIGEST}, headers=ALICE
    )
    assert answer.status_code == 403
    assert answer.json()["problem"]["code"] == "store-sign-in-required"
    assert store.calls == [] and cluster.calls == []


def test_a_tenant_the_store_does_not_serve_acquires_nothing_and_is_told_why(
    api, store, cluster, clock
):
    store.standing = store.contract.example("TenantRefused")
    sign_in(api, store)
    session = api.get("/api/v1/store/session", headers=ALICE).json()
    assert session["standing"]["served"] is False
    assert session["standing"]["refusal"]["reason"] == "no-reports-for-tenant"

    view = Runner(api, clock).install()
    assert view["stage"] == "failed"
    assert view["error"]["code"] == "tenant-refused"
    assert view["error"]["reason"] == "no-reports-for-tenant"
    assert view["error"]["detail"].startswith(
        "No usage statistics report names https://acme.example."
    )
    assert store.calls_to("POST", "/v1/acquisitions") == []
    assert cluster.calls == []
    # Browsing is as it was.
    assert api.get("/api/v1/store/apps", headers=ALICE).status_code == 200


def test_a_store_token_that_ended_mid_sequence_asks_for_the_sign_in_again(runner, store, cluster):
    store.checkout = True
    runner.install()
    store.token_expired = True
    view = runner.step()
    assert view["stage"] == "failed"
    assert view["failedStage"] == "checkout"
    assert view["error"]["code"] == "store-sign-in-required"
    assert oauth.current("alice\ns1") is None


def test_the_store_asking_for_patience_is_not_a_failure(runner, store, cluster):
    store.checkout = True
    runner.install()
    store.rate_limited = 30
    view = runner.step()
    assert view["stage"] == "checkout"
    assert view["waitSeconds"] == 30


@pytest.mark.parametrize(
    "body",
    [
        {"expectedDigest": "sha256:abc"},
        {"expectedDigest": DIGEST.upper()},
        {},
        {"expectedDigest": DIGEST, "acquisitionId": "../tenant"},
        {"expectedDigest": DIGEST, "version": "1 2"},
        {"expectedDigest": DIGEST, "mode": "update"},
        {"expectedDigest": DIGEST, "credential": "x"},
    ],
)
def test_a_request_that_is_not_well_formed_starts_nothing(api, store, cluster, body):
    sign_in(api, store)
    sent = len(store.calls)
    answer = api.post(f"/api/v1/apps/{PAID}/operation", json=body, headers=ALICE)
    assert answer.status_code in (400, 422)
    assert len(store.calls) == sent and cluster.calls == []


def test_a_sequence_is_refused_from_another_origin(runner, store, cluster):
    answer = runner.api.post(
        f"/api/v1/apps/{PAID}/operation",
        json={"expectedDigest": DIGEST},
        headers={**ALICE, "Origin": "https://evil.example"},
    )
    assert answer.status_code == 403
    assert cluster.calls == []


# ── replacing a credential ──────────────────────────────────────────────────


def test_a_credential_is_replaced_at_the_store_and_set_at_the_custodian(runner, store, cluster):
    runner.install()
    acquisition = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()["acquisition"]
    cluster.calls.clear()

    answer = runner.api.post(
        f"/api/v1/acquisitions/{acquisition['id']}/credential",
        json={"rotate": True},
        headers=ALICE,
    )
    assert answer.status_code == 200
    assert answer.json() == {
        "acquisition": acquisition["id"],
        "rotated": True,
        "repositories": [{"name": REPOSITORY, "url": REGISTRY, "outcome": "set"}],
    }
    assert len(store.calls_to("POST", f"/v1/acquisitions/{acquisition['id']}/credential")) == 1
    # Only the custodian is asked: the repository was declared at install.
    assert cluster.order() == [f"custodian PUT /v1/credentials/repository-{REPOSITORY}"]
    assert cluster.credentials[REPOSITORY] == {"username": USERNAME, "password": ROTATED_TOKEN}
    assert ROTATED_TOKEN not in answer.text and USERNAME not in answer.text


def test_setting_a_credential_again_does_not_replace_it(runner, store, cluster):
    runner.install()
    acquisition = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()["acquisition"]
    del cluster.credentials[REPOSITORY]
    answer = runner.api.post(
        f"/api/v1/acquisitions/{acquisition['id']}/credential", json={}, headers=ALICE
    )
    assert answer.json()["rotated"] is False
    assert store.calls_to("POST", f"/v1/acquisitions/{acquisition['id']}/credential") == []
    assert cluster.credentials[REPOSITORY]["password"] == REGISTRY_TOKEN


def test_a_repository_the_cluster_does_not_have_is_reported_as_that(runner, store, cluster):
    runner.install()
    acquisition = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()["acquisition"]
    cluster.synced.clear()
    cluster.repositories.clear()
    answer = runner.api.post(
        f"/api/v1/acquisitions/{acquisition['id']}/credential",
        json={"rotate": True},
        headers=ALICE,
    ).json()
    assert answer["repositories"][0]["outcome"] == "not-declared"
    assert answer["repositories"][0]["problem"]["source"] == "custodian"
    assert ROTATED_TOKEN not in json.dumps(answer)


def test_an_acquisition_id_that_is_not_one_never_reaches_the_store(runner, store, cluster):
    sent = len(store.calls)
    for bad in ("a.b", "x" * 65, "a%2Fb"):
        answer = runner.api.post(
            f"/api/v1/acquisitions/{bad}/credential", json={"rotate": True}, headers=ALICE
        )
        assert answer.status_code in (400, 404)
    assert len(store.calls) == sent


@pytest.mark.parametrize("waiting", ["approval", "confirmation"])
def test_an_acquisition_that_waits_without_a_checkout_is_asked_again(
    runner, store, cluster, waiting
):
    """A 1.2 store: the account does not manage the tenant yet, or the store
    has not decided. Nothing to open; the outcome is asked for again."""
    store.waiting_for = waiting
    view = runner.install()
    assert view["stage"] == "checkout" and view["checkout"] is None
    assert view["acquisition"]["waitingFor"] == waiting
    assert view["waitSeconds"] >= 2
    assert cluster.order() == []

    store.complete_checkout()
    view = runner.run(runner.step())
    assert view["stage"] == "done"
    assert view["acquisition"]["waitingFor"] is None


METERING_KEY = "m" * 64


def test_an_app_priced_by_use_is_handed_its_metering_after_the_install(runner, store, cluster):
    store.metering = {
        "url": "https://commerce-hooks.team.example/api/v1/usage/reports",
        "install": "acq_01JA2M8Y",
        "key": METERING_KEY,
    }
    view = runner.install(forEveryone=True)
    assert view["stage"] == "done"
    assert cluster.order()[-1] == "custodian PUT /v1/credentials/app-acme-nextcloud-base-ee-metering"
    assert cluster.supplied[("nextcloud-base-ee", "metering")] == store.metering
    # Never told to the browser, and not kept once the custodian has it.
    state = runner.api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE)
    for said in [*runner.answers, state.text]:
        assert METERING_KEY not in said
    assert METERING_KEY not in repr(sequence.find("alice\ns1", PAID))


def test_an_app_without_metering_sets_none(runner, store, cluster):
    runner.install(forEveryone=True)
    assert not cluster.supplied
