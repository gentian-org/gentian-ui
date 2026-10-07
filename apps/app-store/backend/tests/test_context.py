"""Who the app is for, what it shows without a store, and what it still
shows when the store is away."""

from conftest import ALICE, make_settings
from fakestore import PAID
from test_sequence import DIGEST, Runner
from test_sign_in import sign_in

from app.core.config import get_settings
from app.main import app


def test_whether_a_person_may_install_is_the_directors_answer(api, store, cluster):
    context = api.get("/api/v1/context", headers=ALICE).json()
    assert context == {
        "tenant": "acme",
        "name": None,
        "mayInstall": True,
        "storeConfigured": True,
        "appStore": {"available": True, "reason": None},
        "adminConsoleUrl": "https://admin.acme.example/",
    }
    # Asked with the person's own token.
    me = [c for c in cluster.calls if c.path == "/v1/tenants/acme/me"]
    assert [c.bearer for c in me] == ["Bearer alice.s1"]
    # And the store was asked nothing for it.
    assert store.calls == []


def test_a_person_who_may_not_install_is_told_so(api, store, cluster):
    cluster.relations["can_install_app"] = False
    assert api.get("/api/v1/context", headers=ALICE).json()["mayInstall"] is False


def test_the_app_adds_no_authorisation_of_its_own(api, store, cluster, clock):
    """`mayInstall` builds a page. It stops nobody: a person the page would
    not have been shown to is answered by the director, as everybody is."""
    cluster.relations["can_install_app"] = False
    cluster.install_refusal = (403, "forbidden: can_install_app on tenant:acme")
    sign_in(api, store)
    view = Runner(api, clock).install()
    assert view["stage"] == "failed"
    assert view["error"]["source"] == "director"
    assert view["error"]["status"] == 403


def test_a_director_that_cannot_be_reached_is_not_read_as_a_refusal(api, store, cluster):
    cluster.down.add("director")
    answer = api.get("/api/v1/context", headers=ALICE)
    assert answer.status_code == 502
    assert answer.json()["problem"]["source"] == "director"


def test_a_cluster_that_does_not_report_says_the_app_store_is_not_offered(api, store, cluster):
    cluster.app_store = {"available": False, "reason": "licence-report-disabled"}
    context = api.get("/api/v1/context", headers=ALICE).json()
    assert context["appStore"] == {"available": False, "reason": "licence-report-disabled"}


def test_an_usher_that_cannot_be_asked_blocks_nothing(api, store, cluster):
    cluster.down.add("usher")
    context = api.get("/api/v1/context", headers=ALICE).json()
    assert context["appStore"] is None
    assert context["mayInstall"] is True


def test_a_cluster_that_names_no_store_says_so_and_asks_nobody(api, store, cluster):
    settings = make_settings(STORE_URL=None)
    app.dependency_overrides[get_settings] = lambda: settings
    assert api.get("/api/v1/context", headers=ALICE).json()["storeConfigured"] is False
    for path in ("/api/v1/store/apps", "/api/v1/store/meta", "/api/v1/overview"):
        answer = api.get(path, headers=ALICE)
        assert answer.status_code == 503
        assert answer.json()["problem"]["code"] == "store-not-configured"
    assert store.calls == []


def test_installed_and_acquired_are_joined(api, store, cluster, clock):
    sign_in(api, store)
    Runner(api, clock).install(forEveryone=True)
    # Installed by command, with no acquisition behind it.
    cluster.apps["odoo-base-ce"] = {"profile": "odoo-base-ce"}
    cluster.states["odoo-base-ce"] = {"profile": "odoo-base-ce", "phase": "installing"}
    # Acquired and not installed.
    free = store.contract.example("AcquisitionFree")
    store.acquisitions[free["id"]] = free

    overview = api.get("/api/v1/overview", headers=ALICE).json()
    rows = {r["profile"]: r for r in overview["rows"]}
    assert set(rows) == {"nextcloud-base-ee", "odoo-base-ce", "xwiki-ce"}

    installed = rows["nextcloud-base-ee"]
    assert installed["stage"] == "ready"
    assert installed["coordinate"] == PAID
    assert installed["installed"]["digest"] == DIGEST
    assert installed["installed"]["forEveryone"] is True
    assert installed["latest"] == {"version": "31.0.4", "digest": DIGEST}
    assert installed["updateAvailable"] is False

    by_command = rows["odoo-base-ce"]
    assert by_command["stage"] == "installing"
    assert by_command["acquisition"] is None and by_command["coordinate"] is None

    acquired = rows["xwiki-ce"]
    assert acquired["stage"] == "acquired"
    assert acquired["installed"] is None
    assert acquired["acquisition"]["id"] == free["id"]


def test_an_update_is_available_when_the_stores_newest_build_is_not_the_one_pinned(
    api, store, cluster, clock
):
    sign_in(api, store)
    Runner(api, clock).install()
    cluster.apps["nextcloud-base-ee"]["digest"] = "sha256:" + "9a" * 32
    row = api.get("/api/v1/overview", headers=ALICE).json()["rows"][0]
    assert row["updateAvailable"] is True
    assert row["latest"]["version"] == "31.0.4"


def test_with_the_store_away_the_clusters_side_is_still_shown(api, store, cluster, clock):
    sign_in(api, store)
    Runner(api, clock).install()
    store.unavailable = True

    overview = api.get("/api/v1/overview", headers=ALICE)
    assert overview.status_code == 200
    body = overview.json()
    assert body["storeProblem"]["code"] == "store-unavailable"
    assert body["storeProblem"]["detail"] == "Maintenance until 06:00 UTC."
    assert [r["profile"] for r in body["rows"]] == ["nextcloud-base-ee"]
    assert body["rows"][0]["stage"] == "ready"
    assert body["rows"][0]["acquisition"] is None

    state = api.get(f"/api/v1/apps/{PAID}/state", headers=ALICE).json()
    assert state["stage"] == "ready"
    assert state["storeProblem"]["code"] == "store-unavailable"


def test_without_a_store_sign_in_the_clusters_side_is_shown_and_the_store_is_not_asked(
    api, store, cluster
):
    cluster.apps["nextcloud-base-ee"] = {"profile": "nextcloud-base-ee", "digest": DIGEST}
    cluster.states["nextcloud-base-ee"] = {"profile": "nextcloud-base-ee", "phase": "ready"}
    overview = api.get("/api/v1/overview", headers=ALICE).json()
    assert overview["storeSignedIn"] is False
    assert overview["rows"][0]["stage"] == "ready"
    assert [c for c in store.calls if "authorization" in c.headers] == []
    assert store.calls_to("GET", "/v1/acquisitions") == []


def test_with_a_cluster_service_away_the_rest_is_still_shown(api, store, cluster, clock):
    sign_in(api, store)
    Runner(api, clock).install()
    cluster.down.add("usher")
    body = api.get("/api/v1/overview", headers=ALICE).json()
    assert body["clusterProblems"]["usher"]["code"] == "unreachable"
    assert body["rows"][0]["installed"]["digest"] == DIGEST
    assert body["rows"][0]["stage"] == "installed"


def test_readiness_names_what_is_missing(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.routes import health

    monkeypatch.setattr(health, "get_settings", lambda: make_settings(DIRECTOR_URL=None))
    answer = TestClient(app).get("/readyz")
    assert answer.status_code == 503
    assert "DIRECTOR_URL" in answer.json()["errors"][0]

    monkeypatch.setattr(health, "get_settings", lambda: make_settings(STORE_URL=None))
    answer = TestClient(app).get("/readyz")
    # No store is an answer the app gives, not a reason to be unready.
    assert answer.status_code == 200
    assert answer.json()["checks"]["store"] == "none"
