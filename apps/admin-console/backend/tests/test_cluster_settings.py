"""The console reads and writes the cluster's settings through the director.

The same rule as the tile list, for the same reason: the console holds no
credential and decides nothing. The caller's own token goes to the director,
which asks whether that person may audit or configure the cluster, and
whatever it answers comes back unchanged -- including a refusal. A console
that softened a 403 into an empty screen would be inventing an authorisation
answer it has no standing to give.

The write is a commit, not a save. 202 with a commit means git has the change
and the cluster does not yet; 200 means the values already held. Both have to
survive the proxy intact, because the screen shows the difference.
"""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cluster
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(cluster.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings(**over) -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL=over.pop("director_url", "http://director.test:8080"),
        REGISTRAR_URL=over.pop("registrar_url", "http://registrar.test:8080"),
        GENTIAN_CLUSTER_ID=over.pop("cluster_id", "demo"),
    )


def _fake_client(monkeypatch, responder, seen: dict):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"] = method
            seen["url"] = url
            seen["json"] = json
            seen["auth"] = (headers or {}).get("Authorization")
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)
    return FakeClient


CATALOGUE = {
    "cluster": "demo",
    "settings": [
        {
            "path": "mail.serviceMode",
            "doc": "Where mail is sent from.",
            "oneOf": ["kernel", "external"],
            "value": "kernel",
        },
        {"path": "certificates.acmeEnv", "doc": "Which ACME environment issues certificates."},
    ],
}


def test_the_catalogue_and_the_values_arrive_together(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(200, json=CATALOGUE, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/settings", headers={"Authorization": "Bearer person-token"})

    assert r.status_code == 200
    assert seen["url"] == "http://director.test:8080/v1/clusters/demo/settings"
    assert seen["auth"] == "Bearer person-token"
    body = r.json()
    # A setting the claim does not carry has no value at all, rather than an
    # empty one: "unset, so the default applies" is a different answer from
    # "set to nothing", and the screen renders them differently.
    assert "value" not in body["settings"][1]


def test_a_change_comes_back_as_a_commit(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202, json={"status": "committed", "commit": "a1b2c3d4"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.patch(
        "/api/v1/cluster/settings",
        json={"settings": {"mail.serviceMode": "external"}},
        headers={"Authorization": "Bearer person-token"},
    )

    assert r.status_code == 202
    assert r.json()["commit"] == "a1b2c3d4"
    assert seen["method"] == "PATCH"
    assert seen["json"] == {"settings": {"mail.serviceMode": "external"}}
    assert seen["auth"] == "Bearer person-token"


def test_setting_what_already_holds_is_not_a_commit(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200, json={"status": "unchanged"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.patch(
        "/api/v1/cluster/settings",
        json={"settings": {"mail.serviceMode": "kernel"}},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 200
    assert "commit" not in r.json()


@pytest.mark.parametrize("status", [403, 400, 409])
def test_the_directors_refusal_is_passed_through_unchanged(monkeypatch, status):
    """Including 403. Whether this person may configure the cluster is the
    director's answer, read from the authorization store, and the console must
    not dress it up as anything else."""
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            status, json={"error": "refused"}, request=httpx.Request(m, url)
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.patch(
        "/api/v1/cluster/settings",
        json={"settings": {"mail.serviceMode": "external"}},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == status


def test_an_unreachable_director_is_a_gateway_error(monkeypatch):
    def boom(m, url):
        raise httpx.ConnectError("refused", request=httpx.Request(m, url))

    _fake_client(monkeypatch, boom, {})
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/settings", headers={"Authorization": "Bearer t"})
    assert r.status_code == 502


def test_no_token_is_refused_before_anything_is_forwarded():
    client = TestClient(_app(_settings()))
    r = client.get("/api/v1/cluster/settings")
    assert r.status_code == 401


def test_activating_an_administrator_relays_only_the_recovery_address(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            200,
            json={
                "tenant": "acme",
                "username": "admin@acme.k",
                "activation": {"mailed": False, "link": "x"},
            },
            request=httpx.Request(m, url),
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/cluster/tenants/acme/activate-admin",
        json={"recoveryEmail": "owner@example.org", "smuggled": True},
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 200
    # The registrar's, not the director's: the account is a person.
    assert (
        seen["url"]
        == "http://registrar.test:8080/v1/clusters/demo/tenants/acme/actions/activate-admin"
    )
    assert seen["json"] == {"recoveryEmail": "owner@example.org"}

    r = client.post(
        "/api/v1/cluster/tenants/acme/activate-admin",
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 200
    assert seen["json"] == {}


def test_a_tenant_the_cluster_does_not_have_yet_is_answered_as_the_registrar_answered(monkeypatch):
    """A tenant is a commit before it is a tenant on the cluster, and until
    then the registrar refuses its administrator's activation with a status
    that says which stage it is at. The screen tells "not there yet" from a
    failure by that status and that sentence, so both come back as they were
    given: a relay that flattened them into its own error would turn a tenant
    on its way into a fault."""
    for status, said in (
        (404, "tenant not found"),
        (503, "no credential for the realm acme yet: the tenant is still being provisioned"),
        (409, "the administrator account does not exist yet"),
    ):
        answer = {"error": said, "request_id": "r1"}
        _fake_client(
            monkeypatch,
            lambda m, url, status=status, answer=answer: httpx.Response(
                status, json=answer, request=httpx.Request(m, url)
            ),
            {},
        )
        r = TestClient(_app(_settings())).post(
            "/api/v1/cluster/tenants/acme/activate-admin",
            headers={"Authorization": "Bearer person-token"},
        )
        assert r.status_code == status
        assert r.json() == answer


def test_activating_without_a_registrar_says_so_and_asks_nobody(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, lambda m, url: httpx.Response(200, json={}), seen)
    r = TestClient(_app(_settings(registrar_url=None))).post(
        "/api/v1/cluster/tenants/acme/activate-admin",
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 503
    assert "REGISTRAR_URL" in r.json()["detail"]
    assert seen == {}


def test_an_administrators_invitation_is_handed_to_the_registrar_and_nothing_is_kept(monkeypatch):
    """Creating a tenant with a recovery address hands the address to the
    registrar, which keeps the request and sends the invitation when the
    tenant is ready. The relay passes the person's token and the address and
    nothing else, and the registrar's 202 comes back as it was given."""
    seen: dict = {}
    answer = {"tenant": "acme", "state": "pending", "expiresAt": 1791900000}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(202, json=answer, request=httpx.Request(m, url)),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/cluster/tenants/acme/admin-invitation",
        json={"recoveryEmail": "owner@example.org", "smuggled": True},
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 202
    assert r.json() == answer
    assert seen["method"] == "POST"
    assert (
        seen["url"]
        == "http://registrar.test:8080/v1/clusters/demo/tenants/acme/actions/request-admin-invitation"
    )
    assert seen["json"] == {"recoveryEmail": "owner@example.org"}
    assert seen["auth"] == "Bearer person-token"


def test_the_state_of_an_invitation_is_the_registrars_answer(monkeypatch):
    seen: dict = {}
    answers = {
        "/tenants/acme/admin-invitation": {
            "tenant": "acme",
            "state": "not-mailed",
            "reason": "HTTP 500: no relay",
        },
        "/admin-invitations": {"pending": [{"tenant": "acme", "requestedAt": 1, "expiresAt": 2}]},
    }
    for path, answer in answers.items():
        _fake_client(
            monkeypatch,
            lambda m, url, answer=answer: httpx.Response(
                200, json=answer, request=httpx.Request(m, url)
            ),
            seen,
        )
        r = TestClient(_app(_settings())).get(
            f"/api/v1/cluster{path}", headers={"Authorization": "Bearer person-token"}
        )
        assert r.status_code == 200
        assert r.json() == answer
        assert seen["method"] == "GET"
        assert seen["url"] == f"http://registrar.test:8080/v1/clusters/demo{path}"
        assert seen["auth"] == "Bearer person-token"


def test_a_refused_invitation_comes_back_as_the_registrar_refused_it(monkeypatch):
    """The console holds no right of its own: whoever may not configure the
    cluster is refused by the registrar, and a registrar that cannot keep the
    request says so. The screen falls back on what it is told, so neither is
    softened."""
    for status, said in (
        (403, "forbidden"),
        (400, "that is not an address"),
        (503, "this registrar has no database, so it cannot keep an invitation"),
    ):
        answer = {"error": said, "request_id": "r1"}
        _fake_client(
            monkeypatch,
            lambda m, url, status=status, answer=answer: httpx.Response(
                status, json=answer, request=httpx.Request(m, url)
            ),
            {},
        )
        r = TestClient(_app(_settings())).post(
            "/api/v1/cluster/tenants/acme/admin-invitation",
            json={"recoveryEmail": "owner@example.org"},
            headers={"Authorization": "Bearer person-token"},
        )
        assert r.status_code == status
        assert r.json() == answer


def test_an_invitation_without_a_registrar_says_so_and_asks_nobody(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, lambda m, url: httpx.Response(200, json={}), seen)
    client = TestClient(_app(_settings(registrar_url=None)))
    for method, path in (
        ("POST", "/tenants/acme/admin-invitation"),
        ("GET", "/tenants/acme/admin-invitation"),
        ("GET", "/admin-invitations"),
    ):
        r = client.request(
            method, f"/api/v1/cluster{path}", headers={"Authorization": "Bearer person-token"}
        )
        assert r.status_code == 503
        assert "REGISTRAR_URL" in r.json()["detail"]
    assert seen == {}


def test_purging_a_tenant_is_the_directors_purge_action(monkeypatch):
    seen: dict = {}
    _fake_client(
        monkeypatch,
        lambda m, url: httpx.Response(
            202,
            json={"status": "purge_requested", "commit": "abc"},
            request=httpx.Request(m, url),
        ),
        seen,
    )
    client = TestClient(_app(_settings()))
    r = client.post(
        "/api/v1/cluster/tenants/acme/purge",
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 202
    assert seen["url"].endswith("/v1/clusters/demo/tenants/acme/actions/purge")
    assert seen["json"] == {}

    r = client.post(
        "/api/v1/cluster/tenants/acme/purge",
        json={"keepBundles": True, "smuggled": True},
        headers={"Authorization": "Bearer person-token"},
    )
    assert r.status_code == 202
    assert seen["json"] == {"keepBundles": True}
