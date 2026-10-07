"""Where things stand, derived from who knows.

Nothing here is remembered. What a tenant has acquired is the store's answer,
what it has installed is the director's, and what the cluster has made of
that is the usher's; this module asks the three and joins them, so a page
that is loaded in the middle of a sequence -- or after this process has
restarted -- shows where it stands without having been told.

Each of the three may fail on its own, and the other two are still shown:
with the store away, what is installed and how it is doing is still the
cluster's to say.
"""

import asyncio
from typing import Any

from app.core.problems import Refusal
from app.install import sequence
from app.install.sequence import Context
from app.store import oauth, patterns
from app.store.models import Acquisition
from app.store.naming import repository_name

LIVE = ("pending", "confirmed")
MAX_LATEST_LOOKUPS = 40


def acquisition_view(tenant: str, acquisition: Acquisition) -> dict[str, Any]:
    """An acquisition as a screen reads it. It never held a credential: this
    is built from the listing, which carries none."""
    confirmation = acquisition.confirmation
    repositories: dict[str, dict[str, str]] = {}
    if confirmation is not None:
        for item in confirmation.items():
            if item.repository is not None:
                url = item.repository.url
                repositories[url] = {"name": repository_name(tenant, url), "url": url}
    return {
        "id": acquisition.id,
        "coordinate": acquisition.coordinate,
        "status": acquisition.status,
        "createdAt": acquisition.createdAt,
        "updatedAt": acquisition.updatedAt,
        "version": confirmation.version if confirmation else None,
        "digest": confirmation.digest if confirmation else None,
        "addons": (
            [{"coordinate": a.coordinate, "version": a.version} for a in confirmation.addons]
            if confirmation
            else []
        ),
        "repositories": list(repositories.values()),
        "failure": acquisition.failure.model_dump() if acquisition.failure else None,
    }


async def _cluster(ctx: Context) -> tuple[dict | None, dict | None, dict[str, Any]]:
    """(declared apps, their states, what could not be asked)."""
    problems: dict[str, Any] = {}

    async def ask(name: str, call):
        try:
            return await call(ctx)
        except Refusal as refusal:
            problems[name] = refusal.body()["problem"]
            return None

    declared, states = await asyncio.gather(
        ask("director", sequence.declared_apps), ask("usher", sequence.app_states)
    )
    return declared, states, problems


async def _acquisitions(ctx: Context) -> tuple[list[Acquisition] | None, dict[str, Any] | None]:
    """The tenant's acquisitions when the person is signed in to the store:
    (them, why not)."""
    signed_in = oauth.current(ctx.session)
    if signed_in is None:
        return None, None
    try:
        return await ctx.store.acquisitions(signed_in.token, ctx.session), None
    except Refusal as refusal:
        oauth.forget_if_unauthenticated(ctx.session, refusal)
        return None, refusal.body()["problem"]


def _live(acquisitions: list[Acquisition], coordinate: str) -> Acquisition | None:
    """The tenant's live acquisition of a coordinate; there is at most one."""
    return next((a for a in acquisitions if a.coordinate == coordinate and a.status in LIVE), None)


def _stage(installed: dict | None, state: dict | None, acquisition: Acquisition | None) -> str:
    if installed is not None:
        phase = state.get("phase") if state else None
        return phase if phase in ("installing", "ready", "failing") else "installed"
    if acquisition is not None:
        return "checkout" if acquisition.status == "pending" else "acquired"
    return "not-installed"


async def of_app(ctx: Context, coordinate: str) -> dict[str, Any]:
    """Where one entry stands for this tenant."""
    profile = patterns.app_of(coordinate)
    (declared, states, problems), (acquisitions, store_problem) = await asyncio.gather(
        _cluster(ctx), _acquisitions(ctx)
    )
    installed = declared.get(profile) if declared is not None else None
    state = states.get(profile) if states is not None else None
    acquisition = _live(acquisitions, coordinate) if acquisitions is not None else None
    operation = sequence.find(ctx.session, coordinate)
    return {
        "coordinate": coordinate,
        "profile": profile,
        "stage": _stage(installed, state, acquisition),
        "installed": installed,
        "state": state,
        "clusterProblems": problems,
        "storeSignedIn": oauth.current(ctx.session) is not None,
        "storeProblem": store_problem,
        "acquisition": acquisition_view(ctx.tenant, acquisition) if acquisition else None,
        "operation": operation.view() if operation else None,
    }


async def overview(ctx: Context) -> dict[str, Any]:
    """What this tenant has acquired at the store, joined with what is
    installed on the cluster."""
    (declared, states, problems), (acquisitions, store_problem) = await asyncio.gather(
        _cluster(ctx), _acquisitions(ctx)
    )
    rows: dict[str, dict[str, Any]] = {}
    for profile, installed in (declared or {}).items():
        rows[profile] = {
            "profile": profile,
            "coordinate": None,
            "installed": installed,
            "state": (states or {}).get(profile),
            "acquisition": None,
            "latest": None,
        }
    for acquisition in acquisitions or []:
        if acquisition.status not in LIVE:
            continue
        profile = patterns.app_of(acquisition.coordinate)
        row = rows.setdefault(
            profile,
            {
                "profile": profile,
                "coordinate": None,
                "installed": None,
                "state": (states or {}).get(profile),
                "acquisition": None,
                "latest": None,
            },
        )
        if row["acquisition"] is None:
            row["coordinate"] = acquisition.coordinate
            row["acquisition"] = acquisition_view(ctx.tenant, acquisition)

    async def latest(row: dict[str, Any]) -> None:
        """The newest build the store lists, for an entry that is installed:
        an update is available when it is not the build pinned."""
        catalogue, app = row["coordinate"].split("/", 1)
        try:
            detail = await ctx.store.app(catalogue, app, ctx.language)
        except Refusal:
            return
        newest = detail.versions[0]
        row["name"] = detail.name
        row["latest"] = {"version": newest.version, "digest": newest.digest}

    wanted = [r for r in rows.values() if r["coordinate"] and r["installed"]]
    await asyncio.gather(*(latest(r) for r in wanted[:MAX_LATEST_LOOKUPS]))
    for row in rows.values():
        row["stage"] = _stage(
            row["installed"],
            row["state"],
            None,
        )
        if row["installed"] is None and row["acquisition"] is not None:
            row["stage"] = "checkout" if row["acquisition"]["status"] == "pending" else "acquired"
        pinned = row["installed"]["digest"] if row["installed"] else None
        row["updateAvailable"] = bool(
            row["latest"] and pinned and row["latest"]["digest"] != pinned
        )
        operation = sequence.find(ctx.session, row["coordinate"]) if row["coordinate"] else None
        row["operation"] = operation.view() if operation else None
    return {
        "rows": sorted(rows.values(), key=lambda r: r["profile"]),
        "clusterProblems": problems,
        "storeSignedIn": oauth.current(ctx.session) is not None,
        "storeProblem": store_problem,
    }
