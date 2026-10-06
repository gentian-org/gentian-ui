"""A state-changing request is taken only from this application's own origin.

The middleware is built with its arguments here rather than from Settings, so
what is tested is the rule and not which environment variable happened to bind.
One test at the end asks the real application, to prove the rule is wired in.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.origin_check import OriginCheckMiddleware

HOST = "desk.acme.example.org"


def _client(**kwargs) -> TestClient:
    app = FastAPI()
    app.add_middleware(OriginCheckMiddleware, **kwargs)

    @app.api_route("/api/v1/thing", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def thing() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    # The Gateway terminates TLS and passes Host through: this server sees
    # plain http on the public host.
    return TestClient(app, base_url=f"http://{HOST}")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_same_origin_is_accepted_behind_the_edge(method):
    r = _client(https_only=True).request(
        method, "/api/v1/thing", headers={"Origin": f"https://{HOST}"}
    )
    assert r.status_code == 200


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_foreign_origin_is_refused(method):
    r = _client(https_only=True).request(
        method, "/api/v1/thing", headers={"Origin": "https://evil.example.com"}
    )
    assert r.status_code == 403
    assert r.json()["reason"] == "origin_mismatch"
    assert "evil.example.com" in r.json()["detail"]


@pytest.mark.parametrize(
    "origin",
    [
        "https://files.acme.example.org",  # another host of the same zone
        "https://acme.example.org",
        f"https://{HOST}.evil.example.com",
        f"https://{HOST}:8443",
        f"https://{HOST}@evil.example.com",
        "null",
        "",
        "not an origin",
    ],
)
def test_near_misses_are_refused(origin):
    r = _client(https_only=True).post("/api/v1/thing", headers={"Origin": origin})
    assert r.status_code == 403
    assert r.json()["reason"] == "origin_mismatch"


def test_plain_http_origin_is_refused_behind_the_edge():
    r = _client(https_only=True).post("/api/v1/thing", headers={"Origin": f"http://{HOST}"})
    assert r.status_code == 403


def test_plain_http_origin_is_the_servers_own_outside_the_edge():
    """Local development: the page and the API are both on http."""
    client = _client()
    assert client.post("/api/v1/thing", headers={"Origin": f"http://{HOST}"}).status_code == 200
    assert client.post("/api/v1/thing", headers={"Origin": f"https://{HOST}"}).status_code == 200


def test_default_port_and_case_do_not_matter():
    client = _client(https_only=True)
    r = client.post(
        "/api/v1/thing", headers={"Origin": f"https://{HOST.upper()}", "Host": f"{HOST}:443"}
    )
    assert r.status_code == 200


def test_forwarding_headers_from_the_client_change_nothing():
    """X-Forwarded-Host and X-Forwarded-Proto are not what the origin is read from."""
    client = _client(https_only=True)
    forged = {
        "Origin": "https://evil.example.com",
        "X-Forwarded-Host": "evil.example.com",
        "X-Forwarded-Proto": "https",
    }
    assert client.post("/api/v1/thing", headers=forged).status_code == 403
    # The edge's own: Host is the public host, the proto header says https.
    behind = {"Origin": f"https://{HOST}", "X-Forwarded-Proto": "https"}
    assert client.post("/api/v1/thing", headers=behind).status_code == 200
    # And a forged proto does not make an http origin acceptable under edge.
    downgraded = {"Origin": f"http://{HOST}", "X-Forwarded-Proto": "http"}
    assert client.post("/api/v1/thing", headers=downgraded).status_code == 403


def test_allow_listed_origin_is_accepted():
    client = _client(https_only=True, trusted_origins=["http://localhost:5173/", "rubbish"])
    assert client.post("/api/v1/thing", headers={"Origin": "http://localhost:5173"}).status_code == 200
    assert client.post("/api/v1/thing", headers={"Origin": "http://localhost:5174"}).status_code == 403


@pytest.mark.parametrize("site", ["cross-site", "same-site", "none"])
def test_fetch_site_without_origin_is_refused_unless_same_origin(site):
    r = _client(https_only=True).post("/api/v1/thing", headers={"Sec-Fetch-Site": site})
    assert r.status_code == 403
    assert r.json()["reason"] == "cross_site_request"


def test_fetch_site_same_origin_without_origin_is_accepted():
    r = _client(https_only=True).post("/api/v1/thing", headers={"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200


def test_origin_decides_when_both_headers_are_present():
    client = _client(https_only=True)
    r = client.post(
        "/api/v1/thing",
        headers={"Origin": "https://evil.example.com", "Sec-Fetch-Site": "same-origin"},
    )
    assert r.status_code == 403


def test_a_client_that_is_not_a_browser_is_accepted():
    r = _client(https_only=True).post("/api/v1/thing", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_safe_methods_are_never_refused(method):
    headers = {"Origin": "https://evil.example.com", "Sec-Fetch-Site": "cross-site"}
    client = _client(https_only=True)
    assert client.request(method, "/api/v1/thing", headers=headers).status_code != 403
    assert client.get("/healthz", headers=headers).status_code == 200


def test_the_application_has_the_check():
    from app.main import app

    client = TestClient(app)
    assert client.get("/healthz", headers={"Origin": "https://evil.example.com"}).status_code == 200
    refused = client.post(
        "/no-such-route", headers={"Origin": "https://evil.example.com"}
    )
    assert refused.status_code == 403
    assert refused.json()["reason"] == "origin_mismatch"
    # Not refused by the check; what the router then says is its own business.
    own = client.post("/no-such-route", headers={"Origin": "http://testserver"})
    assert own.status_code == 404
