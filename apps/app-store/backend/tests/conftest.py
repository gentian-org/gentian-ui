"""Test environment.

Every test passes its own Settings explicitly, in environment-variable
spelling, because a Settings built from keyword arguments in field spelling
silently ignores them and the process environment wins. The variables here
are only what a test that never constructs Settings would otherwise inherit.

`get_current_user` reads the process's settings, not the ones a test
overrides, and this file turns authentication off there. So the tests that
need to know WHO is asking -- every one about a store sign-in being bound to
a cluster session -- replace `get_current_user` itself, with one that reads
the person and their session out of the bearer the test sent.
"""

import os

os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ENVIRONMENT", "local")

import httpx
import pytest
from definition import Contract
from fakecluster import CUSTODIAN, DIRECTOR, USHER, FakeCluster
from fakestore import BASE, FakeStore
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient

from app.core import director
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.install import sequence
from app.store import client as store_client
from app.store import oauth

TENANT = "acme"
HOST = "store.acme.example"
# "Bearer <sub>.<sid>": the person, and their cluster session.
ALICE = {"Authorization": "Bearer alice.s1"}
ALICE_ELSEWHERE = {"Authorization": "Bearer alice.s2"}
BOB = {"Authorization": "Bearer bob.s9"}

_bearer = HTTPBearer(auto_error=False)


def make_settings(**over) -> Settings:
    base = {
        "AUTH_DISABLED": "true",
        "TENANT_ID": TENANT,
        "APP_HOST": HOST,
        "STORE_URL": BASE,
        "DIRECTOR_URL": DIRECTOR,
        "CUSTODIAN_URL": CUSTODIAN,
        "USHER_URL": USHER,
        "GENTIAN_CLUSTER_ID": "cluster-under-test",
    }
    base.update(over)
    return Settings(**{k: v for k, v in base.items() if v is not None})


@pytest.fixture(scope="session")
def contract() -> Contract:
    return Contract()


class Clock:
    """Time the tests move by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch) -> Clock:
    clock = Clock()
    for module in (store_client, oauth, sequence):
        monkeypatch.setattr(module, "clock", clock)
    return clock


@pytest.fixture
def store(contract, monkeypatch, clock):
    """The fake store, wired in where this app reaches a store. The test
    fails if the fake answered anything the definition does not allow."""
    fake = FakeStore(contract)
    store_client.reset()
    oauth.reset()
    sequence.reset()
    monkeypatch.setattr(store_client, "TRANSPORT", fake.transport())

    async def resolve(host: str) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(store_client, "resolve", resolve)
    yield fake
    store_client.reset()
    oauth.reset()
    sequence.reset()
    assert fake.violations == [], "the fake store answered outside the definition"


@pytest.fixture
def cluster(monkeypatch) -> FakeCluster:
    fake = FakeCluster(TENANT)

    class Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, method, url, params=None, json=None, headers=None):
            return fake.handle(method, url, json, headers)

    # director.py's own httpx, not the module the store client uses: only the
    # cluster's services are stood in for here.
    monkeypatch.setattr(director, "httpx", _HttpxWith(Client))
    return fake


class _HttpxWith:
    """httpx as `app.core.director` sees it, with another AsyncClient."""

    def __init__(self, client) -> None:
        self.AsyncClient = client

    def __getattr__(self, name):
        return getattr(httpx, name)


def _person(credentials: HTTPAuthorizationCredentials | None) -> dict:
    if credentials is None or "." not in credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub, sid = credentials.credentials.split(".", 1)
    return {"sub": sub, "sid": sid, "tenant": TENANT}


@pytest.fixture
def api(store, cluster):
    """The application, with the fake store and the fake cluster behind it."""
    from fastapi import Depends

    from app.main import app

    async def current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> dict:
        return _person(credentials)

    settings = make_settings()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_current_user] = current_user
    try:
        yield TestClient(app, follow_redirects=False)
    finally:
        app.dependency_overrides.clear()
