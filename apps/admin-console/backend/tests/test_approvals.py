# SPDX-License-Identifier: Apache-2.0
"""The Approvals screen's relays: the cluster's list from the usher, and the
security officer's approval or decline to the director, for the request's
tenant."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import approvals
from app.core import director
from app.core.config import Settings, get_settings

_person = {"Authorization": "Bearer officer-token"}


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(approvals.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        USHER_URL="http://usher.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )


def _fake_client(monkeypatch, body, seen: dict, status: int = 200):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            seen["method"], seen["url"], seen["json"] = method, url, json
            seen["auth"] = (headers or {}).get("Authorization")
            return httpx.Response(status, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def _client() -> TestClient:
    return TestClient(_app(_settings()))


def test_the_list_is_the_ushers_answer_for_the_cluster_untouched(monkeypatch):
    seen: dict = {}
    body = {
        "approvals": [
            {
                "tenant": "acme",
                "profile": "crm",
                "install": "crm",
                "privilege": "podSecurity/run-as-root",
                "approvedBy": "security-officer",
                "reason": "writes its cache as root",
                "requestedBy": "tom@acme.example",
                "requestedAt": "2026-10-21T09:12:00Z",
            }
        ]
    }
    _fake_client(monkeypatch, body, seen)
    answer = _client().get("/api/v1/admin/approvals", headers=_person)
    assert answer.status_code == 200
    assert answer.json() == body
    # The usher's cluster route, as the caller.
    assert (seen["method"], seen["url"]) == (
        "GET",
        "http://usher.test:8080/v1/clusters/demo/approvals",
    )
    assert seen["auth"] == "Bearer officer-token"


def test_the_ushers_refusal_comes_back_as_it_is(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"error": "forbidden"}, seen, status=403)
    answer = _client().get("/api/v1/admin/approvals", headers=_person)
    assert answer.status_code == 403
    assert answer.json() == {"error": "forbidden"}


def test_an_approval_goes_to_the_directors_privilege_route_for_the_requests_tenant(monkeypatch):
    seen: dict = {}
    _fake_client(monkeypatch, {"status": "updated", "commit": "abc"}, seen, status=202)
    answer = _client().put(
        "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root",
        headers=_person,
        json={
            "reason": "reviewed the image; bounded to the pilot",
            "expiresAt": "2027-01-31T00:00:00Z",
        },
    )
    assert answer.status_code == 202
    assert answer.json() == {"status": "updated", "commit": "abc"}
    assert (seen["method"], seen["url"]) == (
        "PUT",
        "http://director.test:8080/v1/tenants/acme/privileges/crm/podSecurity/run-as-root",
    )
    assert seen["json"] == {
        "reason": "reviewed the image; bounded to the pilot",
        "expiresAt": "2027-01-31T00:00:00Z",
    }
    assert seen["auth"] == "Bearer officer-token"


def test_the_directors_refusal_of_an_approval_comes_back_as_it_is(monkeypatch):
    seen: dict = {}
    refusal = {
        "error": "a podSecurity privilege weakens what protects the node; approving one is the security officer's"
    }
    _fake_client(monkeypatch, refusal, seen, status=403)
    answer = _client().put(
        "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root",
        headers=_person,
        json={"reason": "we would like it anyway"},
    )
    assert answer.status_code == 403
    assert answer.json() == refusal


@pytest.mark.parametrize(
    "path, body",
    [
        ("/api/v1/admin/approvals/acme/crm/hostNetwork/x", {"reason": "long enough indeed"}),
        (
            "/api/v1/admin/approvals/Acme/crm/podSecurity/run-as-root",
            {"reason": "long enough indeed"},
        ),
        (
            "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root",
            {"reason": "long enough", "install": "x"},
        ),
        ("/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root", {}),
    ],
)
def test_what_is_not_an_approval_never_reaches_the_director(monkeypatch, path, body):
    seen: dict = {}
    _fake_client(monkeypatch, {}, seen)
    answer = _client().put(path, headers=_person, json=body)
    assert answer.status_code in (400, 422)
    assert seen == {}


def test_a_decline_goes_to_the_directors_action_on_the_app_for_the_requests_tenant(monkeypatch):
    seen: dict = {}
    recorded = {
        "status": "declined",
        "tenant": "acme",
        "profile": "crm",
        "install": "crm",
        "privilege": "podSecurity/run-as-root",
        "request": {
            "declinedBy": "sam@example.com",
            "declinedAt": "2026-10-21T10:00:00Z",
            "declineReason": "no root on shared nodes",
        },
    }
    _fake_client(monkeypatch, recorded, seen, status=202)
    answer = _client().post(
        "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root/decline",
        headers=_person,
        json={"reason": "no root on shared nodes"},
    )
    assert answer.status_code == 202
    assert answer.json() == recorded
    assert (seen["method"], seen["url"]) == (
        "POST",
        "http://director.test:8080/v1/tenants/acme/apps/crm/actions/decline-privilege",
    )
    assert seen["json"] == {
        "privilege": "podSecurity/run-as-root",
        "reason": "no root on shared nodes",
    }
    assert seen["auth"] == "Bearer officer-token"


def test_the_directors_refusal_of_a_decline_comes_back_as_it_is(monkeypatch):
    seen: dict = {}
    refusal = {
        "error": "a podSecurity privilege weakens what protects the node; approving one is the security officer's"
    }
    _fake_client(monkeypatch, refusal, seen, status=403)
    answer = _client().post(
        "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root/decline",
        headers=_person,
        json={"reason": "we would rather not have it"},
    )
    assert answer.status_code == 403
    assert answer.json() == refusal


@pytest.mark.parametrize(
    "path, body",
    [
        (
            "/api/v1/admin/approvals/acme/crm/hostNetwork/x/decline",
            {"reason": "long enough indeed"},
        ),
        (
            "/api/v1/admin/approvals/Acme/crm/podSecurity/run-as-root/decline",
            {"reason": "long enough indeed"},
        ),
        (
            "/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root/decline",
            {"reason": "long enough", "expiresAt": "x"},
        ),
        ("/api/v1/admin/approvals/acme/crm/podSecurity/run-as-root/decline", {}),
    ],
)
def test_what_is_not_a_decline_never_reaches_the_director(monkeypatch, path, body):
    seen: dict = {}
    _fake_client(monkeypatch, {}, seen)
    answer = _client().post(path, headers=_person, json=body)
    assert answer.status_code in (400, 422)
    assert seen == {}
