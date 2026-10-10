"""The realm policy, and the screen that keeps its own shape.

Sessions and lockout are the tenant's declared policy: read and written
through the director, applied by the composition. The password policy is the
realm's and is set in one place, the registrar's action. What this module is
responsible for is the translation — the screen's flat form, each service's
own shape — and two rules: a field nobody asked for is not written, and a
clause of the password policy the form does not show is not lost.
"""

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import security
from app.core import director
from app.core.config import Settings, get_settings


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(security.router, prefix="/api/v1")
    app.dependency_overrides[get_settings] = lambda: settings
    return app


def _settings() -> Settings:
    return Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        REGISTRAR_URL="http://registrar.test:8081",
        GENTIAN_CLUSTER_ID="demo",
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
            seen["method"], seen["url"], seen["json"] = method, url, json
            return responder(method, url)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)


def _answer(status, body):
    return lambda m, url: httpx.Response(status, json=body, request=httpx.Request(m, url))


DECLARED = {
    "tenant": "platform",
    "policy": {
        "session": {"idleMinutes": 30, "maxHours": 8},
        "bruteForce": {"enabled": True, "maxLoginFailures": 5, "lockoutDurationSeconds": 900},
    },
    "defaults": {"session": {"idleMinutes": 720, "maxHours": 12}},
}


def _services(monkeypatch, *, realm_policy="", identity_status=200, action_status=200):
    """The director and the registrar, each answering its own routes.

    Returns every request made, in order, so a test can say which service was
    asked what — which is the point of this module.
    """
    calls: list[dict] = []

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            calls.append({"method": method, "url": url, "json": json, "auth": headers})
            req = httpx.Request(method, url)
            if url.startswith("http://registrar.test:8081"):
                if url.endswith("/identity"):
                    if identity_status != 200:
                        return httpx.Response(
                            identity_status, json={"error": "forbidden"}, request=req
                        )
                    return httpx.Response(
                        200, json={"realm": "platform", "passwordPolicy": realm_policy}, request=req
                    )
                return httpx.Response(
                    action_status,
                    json={"passwordPolicy": (json or {}).get("passwordPolicy")},
                    request=req,
                )
            if method == "GET":
                return httpx.Response(200, json=DECLARED, request=req)
            return httpx.Response(202, json={"status": "updated", "commit": "a1b2c3d"}, request=req)

    monkeypatch.setattr(director.httpx, "AsyncClient", FakeClient)
    return calls


def _get(settings=None):
    return TestClient(_app(settings or _settings())).get(
        "/api/v1/admin/security-policies", headers={"Authorization": "Bearer person"}
    )


def _put(body, settings=None):
    return TestClient(_app(settings or _settings())).put(
        "/api/v1/admin/security-policies", json=body, headers={"Authorization": "Bearer person"}
    )


def test_what_is_not_declared_reads_as_what_the_realm_will_do(monkeypatch):
    """A tenant that declares nothing still has a session length. Reporting a
    zero would read as "no timeout"; the composition's default is the truth,
    and the director sends it alongside."""
    _fake_client(
        monkeypatch,
        _answer(
            200,
            {
                "tenant": "platform",
                "policy": {},
                "defaults": {"session": {"idleMinutes": 720, "maxHours": 12}},
            },
        ),
        {},
    )
    body = _get().json()
    assert body["ssoSessionIdleMinutes"] == 720
    assert body["ssoSessionMaxHours"] == 12
    assert body["bruteForceProtected"] is False


def test_the_screen_reads_sessions_from_the_director_and_passwords_from_the_realm(monkeypatch):
    calls = _services(
        monkeypatch, realm_policy="length(12) and digits(2) and notUsername(undefined)"
    )
    r = _get()
    assert r.status_code == 200
    body = r.json()
    assert body["ssoSessionIdleMinutes"] == 30
    assert body["maxLoginFailures"] == 5
    assert body["passwordMinLength"] == 12
    assert body["passwordRequireDigits"] is True
    assert body["passwordRequireLowercase"] is False
    # What the realm also demands and the form has no control for is shown.
    assert body["passwordPolicyOther"] == ["notUsername(undefined)"]
    assert body["passwordPolicyReadable"] is True
    assert [c["url"] for c in calls] == [
        "http://director.test:8080/v1/tenants/platform/security-policy",
        "http://registrar.test:8081/v1/tenants/platform/identity",
    ]
    # Each as the caller, with the caller's own token.
    assert all(c["auth"] == {"Authorization": "Bearer person"} for c in calls)


def test_a_caller_who_may_not_read_the_realm_sees_the_rest_and_cannot_clear_it(monkeypatch):
    """A form that showed zeros for a policy it could not read would be saved
    as "no policy". It is marked unreadable instead, and a write that carries
    password parts is the registrar's to refuse."""
    calls = _services(monkeypatch, identity_status=403)
    body = _get().json()
    assert body["passwordPolicyReadable"] is False
    assert body["ssoSessionIdleMinutes"] == 30

    calls.clear()
    r = _put({"passwordMinLength": 0, "ssoSessionIdleMinutes": 30})
    assert r.status_code == 403
    assert [c["method"] for c in calls] == ["GET"], "nothing was written"


def test_without_a_registrar_the_rest_of_the_screen_still_answers(monkeypatch):
    _services(monkeypatch)
    settings = Settings(
        AUTH_DISABLED="true",
        KERNEL_DOMAIN="desk.gentian.org",
        TENANT_ID="platform",
        DIRECTOR_URL="http://director.test:8080",
        GENTIAN_CLUSTER_ID="demo",
    )
    body = _get(settings).json()
    assert body["passwordPolicyReadable"] is False
    assert body["ssoSessionMaxHours"] == 8


def test_the_password_policy_is_the_registrars_action_and_never_the_directors(monkeypatch):
    """One way to set it. The director's commit carries sessions and lockout
    and no password block."""
    calls = _services(monkeypatch, realm_policy="length(8)")
    r = _put(
        {
            "passwordMinLength": 12,
            "passwordRequireDigits": True,
            "passwordRequireLowercase": False,
            "passwordHistoryCount": 0,
            "ssoSessionIdleMinutes": 30,
            "ssoSessionMaxHours": 0,
            "rememberMe": False,
            "bruteForceProtected": True,
            "maxLoginFailures": 5,
            "lockoutDurationSeconds": 0,
            "requireTotpAdmins": False,
            "requireTotpMembers": "none",
        }
    )
    assert r.status_code == 202
    assert r.json()["commit"] == "a1b2c3d"
    written = [c for c in calls if c["method"] != "GET"]
    assert [(c["method"], c["url"]) for c in written] == [
        ("POST", "http://registrar.test:8081/v1/tenants/platform/actions/set-password-policy"),
        ("PUT", "http://director.test:8080/v1/tenants/platform/security-policy"),
    ]
    assert written[0]["json"] == {"passwordPolicy": "length(12) and digits(1)"}
    # Only what was asked for, and nothing about passwords.
    assert written[1]["json"] == {
        "session": {"idleMinutes": 30},
        "bruteForce": {"enabled": True, "maxLoginFailures": 5},
    }


def test_what_the_form_does_not_show_or_did_not_change_is_kept(monkeypatch):
    """The form can say "at least one digit". A realm that demands two keeps
    two when that box was left ticked, and a clause the form has no control
    for is carried back as written."""
    calls = _services(
        monkeypatch,
        realm_policy="length(8) and digits(2) and notUsername(undefined) and upperCase(1)",
    )
    r = _put(
        {
            "passwordMinLength": 14,
            "passwordRequireDigits": True,
            "passwordRequireUppercase": False,
            "passwordRequireSpecialChars": True,
        }
    )
    assert r.status_code == 202
    action = next(c for c in calls if c["method"] == "POST")
    assert action["json"] == {
        "passwordPolicy": "length(14) and digits(2) and notUsername(undefined) and specialChars(1)"
    }


def test_an_unchanged_password_form_writes_nothing_to_the_realm(monkeypatch):
    calls = _services(monkeypatch, realm_policy="length(12) and digits(2)")
    r = _put({"passwordMinLength": 12, "passwordRequireDigits": True, "ssoSessionIdleMinutes": 45})
    assert r.status_code == 202
    assert [c["method"] for c in calls] == ["GET", "PUT"]


def test_a_form_without_password_parts_does_not_ask_the_registrar(monkeypatch):
    calls = _services(monkeypatch, realm_policy="length(12)")
    r = _put({"ssoSessionIdleMinutes": 45})
    assert r.status_code == 202
    assert [c["url"] for c in calls] == [
        "http://director.test:8080/v1/tenants/platform/security-policy"
    ]


def test_a_refused_password_policy_leaves_the_declared_policy_alone(monkeypatch):
    """The action first, the commit only if it was accepted: a refusal leaves
    nothing half changed."""
    calls = _services(monkeypatch, realm_policy="length(8)", action_status=403)
    r = _put({"passwordMinLength": 12, "ssoSessionIdleMinutes": 45})
    assert r.status_code == 403
    assert not [c for c in calls if c["method"] == "PUT"]


def test_requiring_a_second_factor_says_it_cannot_yet(monkeypatch):
    """Keycloak expresses it as a conditional flow rather than a realm
    setting, so it cannot be declared with the rest. Refusing with the reason
    beats accepting it and dropping it."""
    seen: dict = {}
    _fake_client(monkeypatch, _answer(202, {"status": "updated"}), seen)
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/security-policies",
        json={"passwordMinLength": 12, "requireTotpMembers": "required"},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 400
    assert "conditional authentication flow" in r.json()["detail"]
    assert not seen, "nothing should have been forwarded"


def test_the_directors_refusal_is_passed_through_unchanged(monkeypatch):
    _fake_client(monkeypatch, _answer(403, {"error": "forbidden"}), {})
    r = TestClient(_app(_settings())).put(
        "/api/v1/admin/security-policies",
        json={"ssoSessionIdleMinutes": 45},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 403


def test_no_token_is_refused_before_anything_is_forwarded():
    assert TestClient(_app(_settings())).get("/api/v1/admin/security-policies").status_code == 401
