"""Signing a person in to the store.

The one sign-in flow a platform component behind the edge runs, and the three
conditions it is held to. What is proved here is the first and the second:
the code is exchanged by this process and the token stays in it, bound to the
cluster session that started the sign-in; and the address the issuer is told
to redirect to is exactly this app's own callback.
"""

import base64
import hashlib
import logging
from urllib.parse import parse_qs, urlsplit

from conftest import ALICE, ALICE_ELSEWHERE, BOB, HOST, make_settings
from fakestore import ISSUER, REFRESH_TOKEN, STORE_TOKEN

from app.core.config import get_settings
from app.store import oauth


def begin(api, who=ALICE) -> dict[str, str]:
    answer = api.post("/api/v1/store/sign-in", headers=who)
    assert answer.status_code == 200, answer.text
    url = answer.json()["authorizationUrl"]
    return {"url": url, **{k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}}


def sign_in(api, store, who=ALICE) -> None:
    request = begin(api, who)
    answer = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=who)
    assert answer.status_code == 303
    assert answer.headers["location"] == "/signed-in"


def test_the_authorization_request_is_the_definitions(api, store):
    request = begin(api)
    assert request["url"].startswith(f"{ISSUER}/authorize?")
    assert request["response_type"] == "code"
    assert request["client_id"] == "gentian-app-store"
    # Exactly this app's own callback: https, the app's host, no port, the
    # one path, no query.
    assert request["redirect_uri"] == f"https://{HOST}/oauth/callback"
    # The tenant's address as the licence report spells it.
    assert request["tenant_url"] == "https://acme.example"
    assert request["scope"] == "store.read store.acquire"
    assert request["code_challenge_method"] == "S256"
    assert set(request) == {
        "url",
        "response_type",
        "client_id",
        "redirect_uri",
        "scope",
        "state",
        "code_challenge",
        "code_challenge_method",
        "tenant_url",
    }
    # Nothing was exchanged yet, and no client secret exists to send.
    assert store.calls_to("POST", "/token") == []


def test_the_code_is_exchanged_here_with_the_verifier_of_the_challenge(api, store):
    request = begin(api)
    api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)

    exchange = store.calls_to("POST", "/token")
    assert len(exchange) == 1
    form = exchange[0].form
    assert form["grant_type"] == "authorization_code"
    assert form["code"] == "the-code"
    assert form["redirect_uri"] == f"https://{HOST}/oauth/callback"
    assert form["client_id"] == "gentian-app-store"
    assert set(form) == {"grant_type", "code", "redirect_uri", "client_id", "code_verifier"}
    assert "authorization" not in exchange[0].headers  # a public client: no secret
    # PKCE, S256: the challenge sent to the browser is the hash of the
    # verifier that only this process ever held.
    digest = hashlib.sha256(form["code_verifier"].encode()).digest()
    assert base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == request["code_challenge"]
    assert form["code_verifier"] not in request["url"]


def test_the_standing_is_asked_first_and_the_browser_learns_only_that(api, store):
    sign_in(api, store)
    # GET /v1/tenant, once, before anything else that is signed in.
    signed = [c for c in store.calls if "authorization" in c.headers]
    assert [c.path for c in signed] == ["/v1/tenant"]

    session = api.get("/api/v1/store/session", headers=ALICE).json()
    assert session["signedIn"] is True
    assert session["expiresInSeconds"] == 900
    assert session["standing"]["served"] is True
    assert session["standing"]["notices"][0]["type"] == "free-licence-limit"
    assert set(session) == {"signedIn", "expiresInSeconds", "standing"}
    assert len(store.calls_to("GET", "/v1/tenant")) == 1


def test_the_token_is_in_no_answer_and_no_log(api, store, cluster, caplog):
    caplog.set_level(logging.DEBUG)
    answers = []
    request = begin(api)
    answers.append(api.post("/api/v1/store/sign-in", headers=ALICE))
    answers.append(
        api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    )
    for path in (
        "/api/v1/store/session",
        "/api/v1/context",
        "/api/v1/overview",
        "/api/v1/apps/gentian/nextcloud-base-ee/state",
        "/api/v1/store/meta",
        "/signed-in",
        "/api/v1/openapi.json",
    ):
        answers.append(api.get(path, headers=ALICE))
    answers.append(api.delete("/api/v1/store/session", headers=ALICE))

    # It was issued, and it is what the store was then asked with.
    assert any(c.headers.get("authorization") == f"Bearer {STORE_TOKEN}" for c in store.calls)
    for answer in answers:
        said = answer.text + " ".join(f"{k}: {v}" for k, v in answer.headers.items())
        assert STORE_TOKEN not in said
        assert REFRESH_TOKEN not in said
    assert STORE_TOKEN not in caplog.text
    assert REFRESH_TOKEN not in caplog.text
    assert "the-code" not in caplog.text


def test_a_refresh_token_is_not_kept(api, store):
    sign_in(api, store)
    kept = repr(vars(oauth._sessions["alice\ns1"])) + repr(oauth._pending)
    assert REFRESH_TOKEN not in kept
    # And not in what a session prints, either.
    assert STORE_TOKEN not in repr(oauth._sessions["alice\ns1"])


def test_a_state_this_app_did_not_issue_signs_nobody_in(api, store):
    begin(api)
    answer = api.get("/oauth/callback?code=the-code&state=" + "x" * 43, headers=ALICE)
    assert answer.status_code == 303
    assert answer.headers["location"] == "/signed-in?error=state"
    assert store.calls_to("POST", "/token") == []
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False


def test_a_callback_with_no_state_signs_nobody_in(api, store):
    begin(api)
    answer = api.get("/oauth/callback?code=the-code", headers=ALICE)
    assert answer.headers["location"] == "/signed-in?error=state"
    assert store.calls_to("POST", "/token") == []


def test_a_state_is_good_for_one_callback(api, store):
    request = begin(api)
    first = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert first.headers["location"] == "/signed-in"
    replay = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert replay.headers["location"] == "/signed-in?error=state"
    assert len(store.calls_to("POST", "/token")) == 1


def test_a_callback_for_another_session_is_refused(api, store):
    """Somebody who is handed a sign-in link, or who lands on a callback that
    was started in another person's session, is not signed in with it -- and
    neither, afterwards, is the person it was started for."""
    request = begin(api, ALICE)

    stolen = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=BOB)
    assert stolen.headers["location"] == "/signed-in?error=other-session"
    assert store.calls_to("POST", "/token") == []
    assert api.get("/api/v1/store/session", headers=BOB).json()["signedIn"] is False

    # The same person in another cluster session is another session.
    request = begin(api, ALICE)
    other = api.get(
        f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE_ELSEWHERE
    )
    assert other.headers["location"] == "/signed-in?error=other-session"

    # The state is used up by the attempt.
    late = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert late.headers["location"] == "/signed-in?error=state"
    assert store.calls_to("POST", "/token") == []


def test_a_store_token_is_found_only_by_the_session_that_obtained_it(api, store):
    sign_in(api, store, ALICE)
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is True
    assert api.get("/api/v1/store/session", headers=ALICE_ELSEWHERE).json()["signedIn"] is False
    assert api.get("/api/v1/store/session", headers=BOB).json()["signedIn"] is False
    refused = api.get("/api/v1/overview", headers=BOB).json()
    assert refused["storeSignedIn"] is False


def test_a_callback_without_a_cluster_session_is_not_served(api, store):
    request = begin(api)
    answer = api.get(f"/oauth/callback?code=the-code&state={request['state']}")
    assert answer.status_code == 401
    assert store.calls_to("POST", "/token") == []


def test_a_pending_sign_in_expires(api, store, clock):
    request = begin(api)
    clock.advance(oauth.PENDING_TTL_SECONDS + 1)
    answer = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert answer.headers["location"] == "/signed-in?error=state"


def test_the_issuer_refusing_is_shown_as_that_and_uses_the_state_up(api, store):
    request = begin(api)
    denied = api.get(
        f"/oauth/callback?error=access_denied&error_description=%3Cscript%3E&state={request['state']}",
        headers=ALICE,
    )
    # A reason from a fixed set: nothing the query said is passed on.
    assert denied.headers["location"] == "/signed-in?error=denied"
    again = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert again.headers["location"] == "/signed-in?error=state"


def test_an_exchange_the_issuer_refuses_signs_nobody_in(api, store):
    store.token_answer = {"error": "invalid_grant"}
    request = begin(api)
    answer = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert answer.headers["location"] == "/signed-in?error=exchange"
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False


def test_a_token_that_is_not_a_bearer_token_is_not_kept(api, store):
    store.token_answer = {"access_token": "abc", "token_type": "mac"}
    request = begin(api)
    answer = api.get(f"/oauth/callback?code=the-code&state={request['state']}", headers=ALICE)
    assert answer.headers["location"] == "/signed-in?error=exchange"


def test_the_token_is_dropped_when_it_expires(api, store, clock):
    sign_in(api, store)
    clock.advance(899)
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is True
    clock.advance(2)
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False
    assert oauth._sessions == {}


def test_signing_out_of_the_store_drops_the_token(api, store):
    sign_in(api, store)
    answer = api.delete("/api/v1/store/session", headers=ALICE)
    assert answer.json() == {"signedIn": False, "expiresInSeconds": None, "standing": None}
    assert oauth._sessions == {}
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False


def test_a_401_from_the_store_ends_the_store_sign_in_and_not_the_cluster_session(api, store):
    sign_in(api, store)
    store.token_expired = True
    overview = api.get("/api/v1/overview", headers=ALICE)
    # Not a 401: that would be the cluster session, and the bundle would
    # reload instead of asking for the store sign-in.
    assert overview.status_code == 200
    assert overview.json()["storeProblem"]["code"] == "store-sign-in-required"
    assert oauth._sessions == {}
    assert api.get("/api/v1/store/session", headers=ALICE).json()["signedIn"] is False


def test_an_issuer_whose_endpoints_are_elsewhere_is_not_used(api, store, monkeypatch):
    original = store._issuer

    def elsewhere(call):
        response = original(call)
        if call.path.startswith("/.well-known/"):
            import httpx

            metadata = response.json()
            metadata["token_endpoint"] = "https://attacker.example/token"
            return httpx.Response(200, json=metadata)
        return response

    monkeypatch.setattr(store, "_issuer", elsewhere)
    answer = api.post("/api/v1/store/sign-in", headers=ALICE)
    assert answer.status_code == 502
    assert oauth._pending == {}


def test_an_issuer_that_is_not_a_public_host_is_not_asked(api, store, monkeypatch):
    store.meta["issuer"] = "https://keycloak.kernel-authentication.svc"
    answer = api.post("/api/v1/store/sign-in", headers=ALICE)
    assert answer.status_code == 502
    assert [c for c in store.calls if "kernel-authentication" in c.url] == []


def test_an_issuer_that_does_not_do_s256_is_not_used(api, store, monkeypatch):
    original = store._issuer

    def plain_only(call):
        response = original(call)
        if call.path.startswith("/.well-known/"):
            import httpx

            return httpx.Response(
                200, json={**response.json(), "code_challenge_methods_supported": ["plain"]}
            )
        return response

    monkeypatch.setattr(store, "_issuer", plain_only)
    assert api.post("/api/v1/store/sign-in", headers=ALICE).status_code == 502


def test_without_its_own_host_the_app_starts_no_sign_in(api, store):
    from app.main import app

    for host in (None, "acme.example", "shop.acme.example", "store.acme.example:8443", "STORE.x.y"):
        settings = make_settings(APP_HOST=host)
        app.dependency_overrides[get_settings] = lambda settings=settings: settings
        answer = api.post("/api/v1/store/sign-in", headers=ALICE)
        assert answer.status_code == 503, host
        assert answer.json()["problem"]["code"] == "host-not-configured"
    assert store.calls == []


def test_starting_a_sign_in_is_refused_from_another_origin(api, store):
    answer = api.post("/api/v1/store/sign-in", headers={**ALICE, "Origin": "https://evil.example"})
    assert answer.status_code == 403
    assert answer.json()["reason"] == "origin_mismatch"
    assert oauth._pending == {}
