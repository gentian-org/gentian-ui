"""The store's picture of an app, put on the app's tile on the desktop.

After an install or an update has rolled out, the store's picture of the app
is fetched the way every store picture is and handed to the tenant's desktop
with the person's own token. What is checked: what the desktop was sent, that
only a PNG from the store's media origin is sent, and that nothing that goes
wrong with it fails the install.
"""

import pytest
from conftest import ALICE, make_settings
from fakecluster import DESKTOP
from fakestore import JPEG, PNG, SVG
from test_sequence import DIGEST, OTHER_DIGEST, PAID, Runner
from test_sign_in import sign_in

from app.core.config import get_settings

TILE = "desktop PUT /api/v1/tenant-tiles/nextcloud-base-ee"


@pytest.fixture
def runner(api, store, cluster, clock) -> Runner:
    from app.main import app

    settings = make_settings(DESKTOP_API_URL=DESKTOP)
    app.dependency_overrides[get_settings] = lambda: settings
    sign_in(api, store)
    return Runner(api, clock)


def test_the_stores_picture_is_put_on_the_apps_tile_once_it_is_ready(runner, store, cluster):
    view = runner.install(forEveryone=True)
    assert view["stage"] == "done"
    assert view["tile"] == {"outcome": "copied", "problem": None}
    # After the install, as the last thing done.
    assert cluster.order()[-2:] == ["director POST /v1/tenants/acme/apps/nextcloud-base-ee", TILE]
    put = cluster.of("desktop", "PUT")[0]
    assert put.content == PNG
    assert put.content_type == "image/png"
    # The person's own token, as for every other service of the cluster.
    assert put.bearer == "Bearer alice.s1"
    # Fetched from the store's media origin, with nothing that names the person.
    fetched = [c for c in store.calls if c.path == "/icons/nextcloud.png"]
    assert len(fetched) == 1
    assert "authorization" not in fetched[0].headers


def test_an_update_puts_the_picture_on_the_tile_again(runner, store, cluster):
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
    assert view["tile"]["outcome"] == "copied"
    assert cluster.order() == ["director POST /v1/tenants/acme/apps/nextcloud-base-ee", TILE]


@pytest.mark.parametrize(
    ("status", "text"),
    [
        (403, "Setting an app's tile for the tenant requires the right to install apps"),
        (422, "A tile is square and at most 1024 pixels wide"),
    ],
)
def test_a_desktop_that_refuses_the_picture_does_not_fail_the_install(
    runner, cluster, status, text
):
    cluster.tile_refusal = (status, text)
    view = runner.install()
    assert view["stage"] == "done"
    assert view["error"] is None
    assert view["tile"]["outcome"] == "failed"
    problem = view["tile"]["problem"]
    assert problem["source"] == "desktop"
    assert problem["status"] == status
    assert problem["detail"] == text


def test_a_desktop_that_cannot_be_reached_does_not_fail_the_install(runner, cluster):
    cluster.down.add("desktop")
    view = runner.install()
    assert view["stage"] == "done"
    assert view["tile"]["outcome"] == "failed"
    assert view["tile"]["problem"]["code"] == "unreachable"


def test_only_a_png_is_handed_to_the_desktop(runner, store, cluster):
    store.media["/icons/nextcloud.png"] = ("image/jpeg", JPEG)
    view = runner.install()
    assert view["stage"] == "done"
    assert view["tile"]["outcome"] == "failed"
    assert view["tile"]["problem"]["code"] == "tile-not-png"
    assert cluster.of("desktop") == []


def test_an_svg_from_the_store_is_never_handed_on(runner, store, cluster):
    store.media["/icons/nextcloud.png"] = ("image/svg+xml", SVG)
    view = runner.install()
    assert view["stage"] == "done"
    assert view["tile"]["outcome"] == "failed"
    assert view["tile"]["problem"]["code"] == "image-refused"
    assert cluster.of("desktop") == []


def test_a_picture_off_the_stores_media_origins_is_not_fetched(runner, store, cluster, monkeypatch):
    example = store.contract.example
    detail = example("AppDetail")
    detail["iconUrl"] = "https://tracker.example/pixel.png"
    monkeypatch.setattr(
        store.contract, "example", lambda name: detail if name == "AppDetail" else example(name)
    )
    view = runner.install()
    assert view["stage"] == "done"
    assert view["tile"]["outcome"] == "failed"
    assert not [c for c in store.calls if "tracker.example" in c.url]
    assert cluster.of("desktop") == []


def test_without_a_desktop_named_nothing_is_fetched_or_sent(api, store, cluster, clock):
    sign_in(api, store)
    view = Runner(api, clock).install()
    assert view["stage"] == "done"
    assert view["tile"] == {"outcome": "no-picture", "problem": None}
    assert cluster.of("desktop") == []
    assert not [c for c in store.calls if c.path == "/icons/nextcloud.png"]


def test_the_digest_the_person_was_shown_is_still_what_is_installed(runner, cluster):
    # The tile is beside the install, not part of it: the install's own
    # answer is unchanged.
    runner.install()
    assert cluster.of("director", "POST")[0].json["digest"] == DIGEST
