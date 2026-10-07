"""Acquire, declare the repository, set its credential, install: one sequence.

What the App Store app does when a person installs an app, in the order the
store API's definition gives it, each step asked of the cluster with the
person's own token:

    acquire      store      POST /v1/acquisitions            (or read the one there is)
    checkout     store      GET  /v1/acquisitions/{id}       until it is no longer pending
    declare      director   PUT  /v1/tenants/{t}/repositories/{name}
    credential   custodian  PUT  /v1/credentials/repository-{name}
    install      director   POST /v1/tenants/{t}/apps/{app}
    addons       director   PUT  /v1/tenants/{t}/apps/{app}/addons
    rollout      usher      GET  /v1/tenants/{t}/apps/status

How it runs
-----------
One step per request. The screen asks for the next step, shows what came of
it, and asks again after the wait it is told; nothing runs here between two
requests, and nothing is retried in the background. That is what makes every
step resumable: a step that failed is asked again, and each one is safe to
repeat -- the store answers an existing acquisition, the director answers
`unchanged` and `already_installed`, the custodian stores the same value
again.

Where it stops for the person
-----------------------------
* `confirm-build`: the store confirmed another build than the one the person
  was shown. Nothing is sent to the cluster until they have seen the one that
  would be.
* `confirm-repository`: the director answered 428 -- the name computed for
  the repository is one this tenant holds for another address. This app
  never repeats a name on a store's word. It shows the director's text, and
  sends `confirm` only with what the person typed.
* `credential-timeout`: the custodian accepts a repository's credential only
  once the declaration has reached the cluster, which takes a sync. It is
  asked again for a bounded time; after that the sequence stops and says so,
  and continues from this step when the person says.
* `failed`: a step was refused. The refusing service's own words are shown,
  and the step can be asked again.

What is kept, and where
-----------------------
An operation lives in this process, for one cluster session and one
coordinate, and is gone when it is done, abandoned or the process restarts.
It holds the repository credential between the confirmation and the
custodian's answer and not a moment longer, and never puts it in a view:
`Operation.view` is everything a browser is told. When an operation is gone,
where a sequence stands is derived from what the store, the director and the
usher say (`app.install.state`), and continuing reads the acquisition again
rather than acquiring again.
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.core import director
from app.core.config import Settings
from app.core.problems import Refusal
from app.store import oauth, patterns
from app.store.client import Store, origin_of
from app.store.media import checkout_origins
from app.store.models import Acquisition, Confirmation
from app.store.naming import credential_name, repository_name

# How long the custodian is asked for before the sequence stops and says so.
CREDENTIAL_WINDOW_SECONDS = 300
OPERATION_TTL_SECONDS = 1800
MAX_OPERATIONS = 500
# The definition: never more often than every two seconds.
MIN_POLL_SECONDS = 2
DEFAULT_POLL_SECONDS = 5
MAX_WAIT_SECONDS = 60
ROLLOUT_POLL_SECONDS = 5

# The stages that end with the person, not with another request.
WAITS_FOR_PERSON = (
    "confirm-build",
    "confirm-repository",
    "credential-timeout",
    "failed",
    "failing",
    "done",
)

# A seam for the tests.
clock = time.monotonic


@dataclass
class Context:
    """What one request brings: who is asking, and with which token."""

    settings: Settings
    store: Store
    session: str
    cluster_token: str = field(repr=False)
    language: str | None = None

    @property
    def tenant(self) -> str:
        return self.settings.tenant_id


@dataclass
class RepositoryStep:
    name: str
    url: str
    username: str | None = field(default=None, repr=False)
    token: str | None = field(default=None, repr=False)
    declared: str | None = None  # None | "unchanged" | "committed"
    credential: str = "none"  # none | pending | waiting | set

    def view(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "url": self.url,
            "declared": self.declared,
            "credential": self.credential,
        }


@dataclass
class Operation:
    session: str
    coordinate: str
    mode: str  # install | update
    for_everyone: bool
    expected_digest: str
    version: str | None = None
    acquisition_id: str | None = None
    idempotency_key: str = field(default_factory=lambda: uuid.uuid4().hex)
    stage: str = "acquire"
    failed_stage: str | None = None
    wait: int = 0
    touched: float = field(default_factory=lambda: clock())
    acquisition_status: str | None = None
    checkout_url: str | None = None
    checkout_expires_at: str | None = None
    confirmation: Confirmation | None = field(default=None, repr=False)
    build_confirmed: bool = False
    repositories: list[RepositoryStep] = field(default_factory=list)
    confirm: dict[str, Any] | None = None
    credential_deadline: float | None = None
    credential_attempts: int = 0
    install: dict[str, Any] | None = None
    addons: dict[str, Any] | None = None
    rollout: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

    @property
    def profile(self) -> str:
        return patterns.app_of(self.coordinate)

    def view(self) -> dict[str, Any]:
        """Everything a browser is told of this operation. No credential."""
        build = None
        if self.confirmation is not None:
            build = {
                "coordinate": self.confirmation.coordinate,
                "version": self.confirmation.version,
                "digest": self.confirmation.digest,
                "addons": [
                    {"coordinate": a.coordinate, "version": a.version, "digest": a.digest}
                    for a in self.confirmation.addons
                ],
            }
        return {
            "coordinate": self.coordinate,
            "mode": self.mode,
            "forEveryone": self.for_everyone,
            "stage": self.stage,
            "failedStage": self.failed_stage,
            "waitsForPerson": self.stage in WAITS_FOR_PERSON,
            "waitSeconds": self.wait,
            "expectedDigest": self.expected_digest,
            "acquisition": (
                {"id": self.acquisition_id, "status": self.acquisition_status}
                if self.acquisition_id
                else None
            ),
            "checkout": (
                {"url": self.checkout_url, "expiresAt": self.checkout_expires_at}
                if self.stage == "checkout" and self.checkout_url
                else None
            ),
            "build": build,
            "repositories": [r.view() for r in self.repositories],
            "confirmRepository": self.confirm,
            "install": self.install,
            "addons": self.addons,
            "rollout": self.rollout,
            "error": self.error,
        }


_operations: dict[tuple[str, str], Operation] = {}


def reset() -> None:
    """Forget every operation. For the tests."""
    _operations.clear()


def _sweep() -> None:
    now = clock()
    for key in [k for k, op in _operations.items() if now - op.touched > OPERATION_TTL_SECONDS]:
        del _operations[key]


def find(session: str, coordinate: str) -> Operation | None:
    _sweep()
    return _operations.get((session, coordinate))


def drop(session: str, coordinate: str) -> None:
    """Stop waiting. The acquisition is the tenant's and stays as it is at
    the store; what is forgotten is this app's place in the sequence, and any
    credential it held."""
    _operations.pop((session, coordinate), None)


def drop_session(session: str) -> None:
    for key in [k for k in _operations if k[0] == session]:
        del _operations[key]


def start(
    session: str,
    coordinate: str,
    *,
    mode: str,
    for_everyone: bool,
    expected_digest: str,
    version: str | None,
    acquisition_id: str | None,
) -> Operation:
    """A new place in the sequence for this session and coordinate, replacing
    any there was. With `acquisition_id` the acquisition is read, never made
    again."""
    _sweep()
    if len(_operations) >= MAX_OPERATIONS and (session, coordinate) not in _operations:
        raise Refusal(status=503, source="app", code="busy")
    operation = Operation(
        session=session,
        coordinate=patterns.coordinate(coordinate),
        mode=mode,
        for_everyone=for_everyone,
        expected_digest=patterns.digest(expected_digest),
        version=patterns.version(version) if version is not None else None,
        acquisition_id=(
            patterns.acquisition_id(acquisition_id) if acquisition_id is not None else None
        ),
    )
    _operations[(session, coordinate)] = operation
    return operation


def _fail(ctx: Context, op: Operation, refusal: Refusal) -> None:
    oauth.forget_if_unauthenticated(ctx.session, refusal)
    if op.stage != "failed":
        op.failed_stage = op.stage
    op.stage = "failed"
    op.wait = 0
    op.error = refusal.body()["problem"]


async def advance(ctx: Context, op: Operation, answer: dict[str, Any] | None = None) -> None:
    """Do the one step this operation stands at."""
    answer = answer or {}
    op.touched = clock()
    op.wait = 0
    if op.stage == "failed":
        if not answer.get("retry") or op.failed_stage is None:
            return
        op.stage, op.failed_stage, op.error = op.failed_stage, None, None
    try:
        await _STEPS[op.stage](ctx, op, answer)
    except Refusal as refusal:
        if refusal.code == "rate-limited" and refusal.source == "store":
            # Not a failure: the store said when to ask again.
            op.wait = min(refusal.retry_after or DEFAULT_POLL_SECONDS, MAX_WAIT_SECONDS)
            return
        _fail(ctx, op, refusal)


# ── the steps ───────────────────────────────────────────────────────────────


async def _acquire(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    standing = await oauth.standing(ctx.store, ctx.session, ctx.language)
    if not standing.served:
        refusal = standing.refusal
        raise Refusal(
            status=403,
            source="store",
            code="tenant-refused",
            reason=refusal.reason if refusal else None,
            detail=refusal.detail if refusal else None,
        )
    token = oauth.require(ctx.session).token
    if op.acquisition_id is not None:
        acquisition, retry_after = await ctx.store.acquisition(
            token, ctx.session, op.acquisition_id, op.version, ctx.language
        )
        if acquisition.coordinate != op.coordinate:
            raise Refusal(status=502, source="store", code="store-format")
    else:
        acquisition, retry_after = await ctx.store.acquire(
            token, ctx.session, op.coordinate, op.version, op.idempotency_key, ctx.language
        )
    await _take(ctx, op, acquisition, retry_after)


async def _checkout(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    token = oauth.require(ctx.session).token
    acquisition, retry_after = await ctx.store.acquisition(
        token, ctx.session, op.acquisition_id or "", op.version, ctx.language
    )
    await _take(ctx, op, acquisition, retry_after)


async def _take(
    ctx: Context, op: Operation, acquisition: Acquisition, retry_after: int | None
) -> None:
    """What an acquisition's status means for the sequence."""
    op.acquisition_id = acquisition.id
    op.acquisition_status = acquisition.status
    if acquisition.status == "pending":
        allowed = checkout_origins(await ctx.store.meta())
        if not acquisition.checkoutUrl or origin_of(acquisition.checkoutUrl) not in allowed:
            # A checkout this app will not open: the address is not on an
            # origin the store's own meta lists for one.
            raise Refusal(status=502, source="app", code="checkout-refused")
        op.stage = "checkout"
        op.checkout_url = acquisition.checkoutUrl
        op.checkout_expires_at = acquisition.checkoutExpiresAt
        op.wait = min(max(retry_after or DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS), MAX_WAIT_SECONDS)
        return
    op.checkout_url = op.checkout_expires_at = None
    if acquisition.status == "cancelled":
        raise Refusal(status=409, source="store", code="acquisition-cancelled")
    if acquisition.status == "failed":
        failure = acquisition.failure
        raise Refusal(
            status=409,
            source="store",
            code="acquisition-failed",
            reason=failure.reason if failure else None,
            detail=failure.detail if failure else None,
        )
    confirmation = acquisition.confirmation
    if confirmation is None or confirmation.coordinate != op.coordinate:
        raise Refusal(status=502, source="store", code="store-format")
    op.confirmation = confirmation
    op.repositories = [] if op.mode == "update" else _repositories(ctx.tenant, confirmation)
    if confirmation.digest != op.expected_digest and not op.build_confirmed:
        op.stage = "confirm-build"
        return
    _after_build(op)


def _repositories(tenant: str, confirmation: Confirmation) -> list[RepositoryStep]:
    """Each distinct repository the confirmation names, under the name it is
    declared by on this cluster."""
    steps: dict[str, RepositoryStep] = {}
    for item in confirmation.items():
        repository = item.repository
        if repository is None:
            continue
        step = steps.get(repository.url)
        if step is None:
            step = steps[repository.url] = RepositoryStep(
                name=repository_name(tenant, repository.url), url=repository.url
            )
        if repository.credential is not None and step.token is None:
            step.username = repository.credential.username
            step.token = repository.credential.token
            step.credential = "pending"
    return list(steps.values())


def _after_build(op: Operation) -> None:
    op.build_confirmed = True
    op.stage = "install" if op.mode == "update" else "declare"


async def _confirm_build(_ctx: Context, op: Operation, answer: dict[str, Any]) -> None:
    # The person repeats the digest they were shown, so what is confirmed is
    # this build and not whichever one the operation holds by then.
    if op.confirmation is not None and answer.get("confirmDigest") == op.confirmation.digest:
        _after_build(op)


async def _declare(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    pending = next((r for r in op.repositories if r.declared is None), None)
    if pending is None:
        op.stage = "credential"
        op.credential_deadline = clock() + CREDENTIAL_WINDOW_SECONDS
        op.credential_attempts = 0
        return
    await _put_repository(ctx, op, pending, None)


async def _put_repository(
    ctx: Context, op: Operation, repository: RepositoryStep, confirm: str | None
) -> None:
    body: dict[str, str] = {"role": "apps", "type": "oci", "url": repository.url}
    if confirm is not None:
        body["confirm"] = confirm
    answer = await director.ask_director(
        ctx.settings,
        "PUT",
        f"/v1/tenants/{patterns.name(ctx.tenant, 'tenant')}/repositories/"
        f"{patterns.name(repository.name, 'repository name')}",
        ctx.cluster_token,
        json_body=body,
    )
    if answer.status == 200:
        repository.declared = "unchanged"
    elif answer.status == 202:
        repository.declared = "committed"
    elif answer.status == 428:
        # A dangerous change, and the director wants the name repeated. Not
        # by this app.
        confirm_with = answer.body.get("confirmWith") if isinstance(answer.body, dict) else None
        op.stage = "confirm-repository"
        op.confirm = {
            "name": repository.name,
            "url": repository.url,
            "text": answer.text,
            "confirmWith": confirm_with if isinstance(confirm_with, str) else None,
        }
        return
    else:
        raise answer.refusal()
    op.confirm = None
    op.stage = "declare"


async def _confirm_repository(ctx: Context, op: Operation, answer: dict[str, Any]) -> None:
    typed = answer.get("confirmRepository")
    if op.confirm is None or not isinstance(typed, str) or not typed or len(typed) > 100:
        return
    repository = next((r for r in op.repositories if r.name == op.confirm["name"]), None)
    if repository is None:
        op.stage = "declare"
        return
    await _put_repository(ctx, op, repository, typed)


async def _credential(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    pending = next((r for r in op.repositories if r.credential in ("pending", "waiting")), None)
    if pending is None:
        _forget_credentials(op)
        op.stage = "install"
        return
    if op.credential_deadline is None:
        op.credential_deadline = clock() + CREDENTIAL_WINDOW_SECONDS
    answer = await _set_credential(ctx, pending.name, pending.username or "", pending.token or "")
    if answer.status == 200:
        pending.credential = "set"
        pending.username = pending.token = None
        return
    if answer.status == 404:
        # The custodian does not know the credential yet: the declaration
        # has not reached the cluster. Asked again, for a bounded time.
        pending.credential = "waiting"
        if clock() >= op.credential_deadline:
            op.stage = "credential-timeout"
            op.error = answer.refusal().body()["problem"]
            return
        op.credential_attempts += 1
        op.wait = min(2**op.credential_attempts, 10)
        return
    raise answer.refusal()


async def _credential_timeout(_ctx: Context, op: Operation, answer: dict[str, Any]) -> None:
    if answer.get("continue"):
        op.stage = "credential"
        op.error = None
        op.credential_deadline = clock() + CREDENTIAL_WINDOW_SECONDS
        op.credential_attempts = 0


def _forget_credentials(op: Operation) -> None:
    """Handed over once and not kept."""
    for repository in op.repositories:
        repository.username = repository.token = None
    if op.confirmation is not None:
        for item in op.confirmation.items():
            if item.repository is not None:
                item.repository.credential = None


async def _set_credential(ctx: Context, repository: str, username: str, token: str):
    return await director.ask_custodian(
        ctx.settings,
        "PUT",
        f"/v1/credentials/{credential_name(patterns.name(repository, 'repository name'))}",
        ctx.cluster_token,
        json_body={"fields": {"username": username, "password": token}},
    )


async def _install(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    confirmation = op.confirmation
    if confirmation is None:
        raise Refusal(status=409, source="app", code="no-confirmation")
    _forget_credentials(op)
    body: dict[str, Any] = {"coordinate": confirmation.coordinate, "digest": confirmation.digest}
    if op.mode == "install":
        # An update leaves it out: moving a pin does not change who may open
        # the app.
        body["defaultGrant"] = op.for_everyone
    answer = await director.ask_director(
        ctx.settings,
        "POST",
        f"/v1/tenants/{patterns.name(ctx.tenant, 'tenant')}/apps/{op.profile}",
        ctx.cluster_token,
        json_body=body,
    )
    if answer.status not in (200, 202) or not isinstance(answer.body, dict):
        raise answer.refusal()
    op.install = {"status": answer.body.get("status"), "commit": answer.body.get("commit")}
    op.stage = "addons" if confirmation.addons else "rollout"


async def _addons(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    """Pin the add-ons the acquisition includes, inside the app just pinned.

    The director replaces the list whole, so what is sent is what the app
    already activates -- by name, which leaves each as it is -- with the
    confirmation's add-ons as builds. Nothing the tenant had switched on is
    switched off by acquiring something.
    """
    confirmation = op.confirmation
    if confirmation is None:
        raise Refusal(status=409, source="app", code="no-confirmation")
    tenant = patterns.name(ctx.tenant, "tenant")
    listed = await director.ask_director(
        ctx.settings, "GET", f"/v1/tenants/{tenant}/apps", ctx.cluster_token
    )
    if listed.status != 200 or not isinstance(listed.body, dict):
        raise listed.refusal()
    entry = next(
        (
            a
            for a in listed.body.get("apps") or []
            if isinstance(a, dict) and a.get("profile") == op.profile
        ),
        None,
    )
    if entry is None:
        raise Refusal(status=409, source="director", code="not-installed")
    pinned = {patterns.app_of(a.coordinate): a for a in confirmation.addons}
    entries: list[Any] = [
        name for name in entry.get("addons") or [] if isinstance(name, str) and name not in pinned
    ]
    entries += [{"coordinate": a.coordinate, "digest": a.digest} for a in pinned.values()]
    answer = await director.ask_director(
        ctx.settings,
        "PUT",
        f"/v1/tenants/{tenant}/apps/{op.profile}/addons",
        ctx.cluster_token,
        json_body={"addons": entries},
    )
    if answer.status not in (200, 202) or not isinstance(answer.body, dict):
        raise answer.refusal()
    op.addons = {"status": answer.body.get("status"), "commit": answer.body.get("commit")}
    op.stage = "rollout"


async def _rollout(ctx: Context, op: Operation, _answer: dict[str, Any]) -> None:
    state = await app_state(ctx, op.profile)
    op.rollout = state
    phase = state["phase"] if state else None
    if phase == "ready":
        op.stage = "done"
    elif phase == "failing":
        op.stage = "failing"
    else:
        op.stage = "rollout"
        op.wait = ROLLOUT_POLL_SECONDS


async def _done(_ctx: Context, _op: Operation, _answer: dict[str, Any]) -> None:
    return None


_STEPS = {
    "acquire": _acquire,
    "checkout": _checkout,
    "confirm-build": _confirm_build,
    "declare": _declare,
    "confirm-repository": _confirm_repository,
    "credential": _credential,
    "credential-timeout": _credential_timeout,
    "install": _install,
    "addons": _addons,
    "rollout": _rollout,
    # A workload that is failing may recover: asking again looks again.
    "failing": _rollout,
    "done": _done,
}


# ── what the cluster says ───────────────────────────────────────────────────


def state_view(entry: Any) -> dict[str, Any] | None:
    """One app of the usher's answer, as a screen reads it: the phase, and
    the cluster's own words for why."""
    if not isinstance(entry, dict):
        return None

    def text(key: str) -> str | None:
        value = entry.get(key)
        return value[:2000] if isinstance(value, str) and value else None

    privileges = entry.get("pendingPrivileges")
    return {
        "phase": text("phase"),
        "ready": entry.get("ready") is True,
        "message": text("message"),
        "failure": text("failure"),
        "pendingPrivileges": [p for p in privileges if isinstance(p, str)]
        if isinstance(privileges, list)
        else [],
    }


async def app_states(ctx: Context) -> dict[str, dict[str, Any]]:
    """What the cluster has made of this tenant's apps, by profile."""
    answer = await director.ask_usher(
        ctx.settings,
        f"/v1/tenants/{patterns.name(ctx.tenant, 'tenant')}/apps/status",
        ctx.cluster_token,
    )
    if answer.status != 200 or not isinstance(answer.body, dict):
        raise answer.refusal()
    out: dict[str, dict[str, Any]] = {}
    for entry in answer.body.get("apps") or []:
        view = state_view(entry)
        if view is not None and isinstance(entry.get("profile"), str):
            out[entry["profile"]] = view
    return out


async def app_state(ctx: Context, profile: str) -> dict[str, Any] | None:
    return (await app_states(ctx)).get(profile)


async def declared_apps(ctx: Context) -> dict[str, dict[str, Any]]:
    """What git says this tenant has installed, by profile."""
    answer = await director.ask_director(
        ctx.settings,
        "GET",
        f"/v1/tenants/{patterns.name(ctx.tenant, 'tenant')}/apps",
        ctx.cluster_token,
    )
    if answer.status != 200 or not isinstance(answer.body, dict):
        raise answer.refusal()
    out: dict[str, dict[str, Any]] = {}
    for entry in answer.body.get("apps") or []:
        if not isinstance(entry, dict) or not isinstance(entry.get("profile"), str):
            continue
        out[entry["profile"]] = {
            "profile": entry["profile"],
            "digest": entry.get("digest") if isinstance(entry.get("digest"), str) else None,
            "forEveryone": entry.get("defaultGrant") is True,
            "addons": [a for a in entry.get("addons") or [] if isinstance(a, str)],
        }
    return out


# ── a repository's credential, on its own ───────────────────────────────────


async def set_credentials(ctx: Context, acquisition_id: str, *, rotate: bool) -> dict[str, Any]:
    """Set an acquisition's repository credentials at the custodian again.

    With `rotate` the store is first asked to replace them -- for when one
    may have leaked; the replaced one keeps working for a day, so the cluster
    never holds only a credential the repository refuses. Without it the
    credential that is valid now is read and set again, which is what a pull
    the repository refused asks for.

    The repository is not declared here: it was when the app was installed,
    and one the custodian does not know is reported as that.
    """
    token = oauth.require(ctx.session).token
    try:
        if rotate:
            confirmation = await ctx.store.replace_credential(token, ctx.session, acquisition_id)
        else:
            acquisition, _ = await ctx.store.acquisition(token, ctx.session, acquisition_id)
            if acquisition.confirmation is None:
                raise Refusal(status=409, source="store", code="acquisition-not-confirmed")
            confirmation = acquisition.confirmation
    except Refusal as refusal:
        oauth.forget_if_unauthenticated(ctx.session, refusal)
        raise
    results = []
    for step in _repositories(ctx.tenant, confirmation):
        result: dict[str, Any] = {"name": step.name, "url": step.url}
        if step.token is None:
            result["outcome"] = "no-credential"
        else:
            try:
                answer = await _set_credential(ctx, step.name, step.username or "", step.token)
                if answer.status == 200:
                    result["outcome"] = "set"
                else:
                    result["outcome"] = "not-declared" if answer.status == 404 else "refused"
                    result["problem"] = answer.refusal().body()["problem"]
            except Refusal as refusal:
                result["outcome"] = "refused"
                result["problem"] = refusal.body()["problem"]
        step.username = step.token = None
        results.append(result)
    return {"acquisition": acquisition_id, "rotated": rotate, "repositories": results}
