"""The literal credential routes must not be shadowed by the catch-all.

`/credentials/{name}` matches anything, "backup-identity" included. FastAPI
resolves in registration order, so with the catch-all declared first every
backup-identity call went to the credential-requirement handler, which
forwarded it to /v1/credentials/backup-identity and got a 404 — an endpoint
that looked missing rather than shadowed, on a page that had just shipped.

Registration order is the thing under test, so this reads the router directly
rather than the app: the routes are mounted into a sub-application and their
paths are not visible from app.routes at all.
"""

from app.api.routes.credentials import router


def _first_index(method: str, path: str) -> int:
    for i, route in enumerate(router.routes):
        if method in (getattr(route, "methods", None) or set()) and route.path == path:
            return i
    raise AssertionError(f"{method} {path} is not registered at all")


def test_backup_identity_is_declared_before_the_name_catch_all():
    catch_all = _first_index("PUT", "/credentials/{name}")
    for method in ("GET", "PUT"):
        literal = _first_index(method, "/credentials/backup-identity")
        assert literal < catch_all, (
            f"{method} /backup-identity is registered after PUT /{{name}}, "
            "which matches it first and forwards it as a credential name"
        )


def test_the_catch_all_still_exists_for_real_credentials():
    """Moving the literal routes up must not strand ordinary credentials."""
    assert _first_index("PUT", "/credentials/{name}") >= 0
