import inspect

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from gentian_app_runtime.extensions import loader
from gentian_app_runtime.extensions.routes import extensions_router


def _refuse():
    raise HTTPException(status_code=401)


def test_the_diagnostics_are_behind_what_the_app_says():
    app = FastAPI()
    app.include_router(extensions_router(loader.ExtensionRegistry, dependencies=[Depends(_refuse)]))
    assert TestClient(app).get("/extensions").status_code == 401


def test_the_diagnostics_report_what_is_loaded():
    app = FastAPI()
    app.include_router(extensions_router(loader.ExtensionRegistry, dependencies=[]))
    body = TestClient(app).get("/extensions").json()
    assert set(body) == {"extensionApi", "extensions", "dropIns"}


@pytest.mark.parametrize("function", [loader.mount_routes, extensions_router])
def test_an_app_has_to_say_who_may_reach_them(function):
    dependencies = inspect.signature(function).parameters["dependencies"]
    assert dependencies.default is inspect.Parameter.empty
