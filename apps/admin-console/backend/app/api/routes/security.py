"""The realm policy a tenant runs under.

How long a session lasts and what happens after repeated failures are declared
in the deployments repository: the director commits them, and the tenant
composition turns them into the realm's own fields.

How strong a password has to be is set in one place, the registrar's action on
the realm (`set-password-policy`), in Keycloak's own spelling. The screen shows
it as parts, so this module reads the realm's policy, shows the parts it knows
and writes back what the form changed. A clause it does not know, or one whose
argument the form cannot show, is kept as it is: the form states what it
shows and nothing else.

Nothing in either path holds a Keycloak credential here. Both requests carry
the caller's own token, and the director and the registrar each decide what
that caller may do.

The screen's shape is flat — `passwordMinLength`, `ssoSessionIdleMinutes` —
and each service's is the shape of the thing it writes. Translating between
them is this module's whole job.
"""

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import director
from app.core.auth import bearer_of, get_current_user
from app.core.config import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["security"])
_bearer = HTTPBearer(auto_error=False)

# Requiring a second factor is not settable yet. Keycloak expresses "this
# group must use TOTP" as a conditional authentication sub-flow, not as a
# realm field, so it cannot be declared the way the rest of this policy is.
# The screen still shows the two controls; a request that tries to change
# them is refused with the reason rather than accepted and dropped.
TOTP_NOT_SETTABLE = (
    "Requiring a second factor is not settable here yet: Keycloak expresses it "
    "as a conditional authentication flow rather than a realm setting, so it "
    "cannot be declared the way the rest of this policy is. Configure it in "
    "the Identity console until this lands."
)


def _tenant(settings: Settings, tenant: str | None) -> str:
    return tenant or settings.tenant_id


# The password policy's parts, as the screen names them and as Keycloak
# spells them. A count carries the number; a requirement is "at least one".
_PASSWORD_COUNTS = (
    ("passwordMinLength", "length"),
    ("passwordHistoryCount", "passwordHistory"),
    ("passwordMaxAgeDays", "forceExpiredPasswordChange"),
)
_PASSWORD_REQUIREMENTS = (
    ("passwordRequireDigits", "digits"),
    ("passwordRequireLowercase", "lowerCase"),
    ("passwordRequireUppercase", "upperCase"),
    ("passwordRequireSpecialChars", "specialChars"),
)
_PASSWORD_FIELDS = tuple(f for f, _ in _PASSWORD_COUNTS + _PASSWORD_REQUIREMENTS)
_CLAUSE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9]*)\((.*)\)\s*$")


def _clauses(policy: str) -> list[tuple[str, str, str]]:
    """Keycloak's policy string as (name, argument, clause as written).

    A piece that is not `name(argument)` keeps an empty name, so it is carried
    back unchanged like any clause this module does not know.
    """
    out = []
    for piece in (policy or "").split(" and "):
        if not piece.strip():
            continue
        m = _CLAUSE.match(piece)
        out.append((m.group(1), m.group(2), piece.strip()) if m else ("", "", piece.strip()))
    return out


def _number(argument: str) -> int:
    try:
        return max(int(argument), 0)
    except ValueError:
        return 0


def _password_flat(policy: str) -> dict:
    """The realm's password policy, as the screen reads it."""
    by_name = {name: arg for name, arg, _ in _clauses(policy) if name}
    known = {name for _, name in _PASSWORD_COUNTS + _PASSWORD_REQUIREMENTS}
    flat: dict = {}
    for field, name in _PASSWORD_COUNTS:
        flat[field] = _number(by_name.get(name, "0"))
    for field, name in _PASSWORD_REQUIREMENTS:
        flat[field] = _number(by_name.get(name, "0")) > 0
    # What the realm also demands and the form has no control for. Shown, so
    # nobody reads the form as the whole policy.
    flat["passwordPolicyOther"] = [
        written for name, _, written in _clauses(policy) if name not in known
    ]
    return flat


def _password_policy(current: str, body: dict) -> str:
    """The policy to write: the realm's own, with the form's parts put in.

    A clause the form does not show is kept as written. So is one the form
    shows and did not change — a realm that demands two digits keeps two,
    because the form can only say "at least one" and would otherwise lower it.
    """
    was = _password_flat(current)
    wanted: dict[str, str | None] = {}
    for field, name in _PASSWORD_COUNTS:
        if field in body and int(body[field] or 0) != was[field]:
            count = int(body[field] or 0)
            wanted[name] = f"{name}({count})" if count > 0 else None
    for field, name in _PASSWORD_REQUIREMENTS:
        if field in body and bool(body[field]) != was[field]:
            wanted[name] = f"{name}(1)" if body[field] else None
    out = []
    seen = set()
    for name, _, written in _clauses(current):
        if name in wanted:
            seen.add(name)
            if wanted[name] is not None:
                out.append(wanted[name])
            continue
        out.append(written)
    for _, name in _PASSWORD_COUNTS + _PASSWORD_REQUIREMENTS:
        if name in wanted and name not in seen and wanted[name] is not None:
            out.append(wanted[name])
    return " and ".join(out)


def _flat(policy: dict, defaults: dict) -> dict:
    """The director's answer, as the screen reads it.

    A field the tenant does not declare is reported as what the realm will
    actually do — the composition's default where there is one, and otherwise
    the value that means "not imposed".
    """
    session = policy.get("session") or {}
    brute = policy.get("bruteForce") or {}
    default_session = (defaults.get("session") or {}) if defaults else {}
    return {
        "ssoSessionIdleMinutes": session.get("idleMinutes", default_session.get("idleMinutes", 0)),
        "ssoSessionMaxHours": session.get("maxHours", default_session.get("maxHours", 0)),
        "rememberMe": session.get("rememberMe", False),
        "bruteForceProtected": brute.get("enabled", False),
        "maxLoginFailures": brute.get("maxLoginFailures", 0),
        "lockoutDurationSeconds": brute.get("lockoutDurationSeconds", 0),
        # Reported as they are, which is off, because nothing here can set
        # them. See TOTP_NOT_SETTABLE.
        "requireTotpAdmins": False,
        "requireTotpMembers": "none",
    }


def _nested(body: dict) -> dict:
    """The screen's session and lockout form, as the thing the director
    commits. The password parts are not the director's and are not in it.

    Only what is asked for: a field left at zero or false is left out
    entirely, so the realm keeps the composition's default rather than having
    a zero written over it.
    """
    session = {
        key: body[flat]
        for key, flat in (
            ("idleMinutes", "ssoSessionIdleMinutes"),
            ("maxHours", "ssoSessionMaxHours"),
            ("rememberMe", "rememberMe"),
        )
        if body.get(flat)
    }
    brute: dict = {}
    if body.get("bruteForceProtected"):
        brute["enabled"] = True
        for key, flat in (
            ("maxLoginFailures", "maxLoginFailures"),
            ("lockoutDurationSeconds", "lockoutDurationSeconds"),
        ):
            if body.get(flat):
                brute[key] = body[flat]

    out = {}
    if session:
        out["session"] = session
    if brute:
        out["bruteForce"] = brute
    return out


async def _realm_password_policy(settings: Settings, tenant: str, token: str) -> Response:
    """The realm's password policy, asked of the registrar as the caller."""
    return await director.forward_to(
        director.registrar_url(settings), "GET", f"/v1/tenants/{tenant}/identity", token
    )


@router.get("/security-policies")
async def security_policies(
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """A READ of state: what this tenant declares for sessions and lockout,
    and the password policy its realm has."""
    name = _tenant(settings, tenant)
    token = bearer_of(credentials)
    answer = await director.forward(settings, "GET", f"/v1/tenants/{name}/security-policy", token)
    if answer.status_code != 200:
        return answer
    body = json.loads(answer.body)
    flat = _flat(body.get("policy") or {}, body.get("defaults") or {})

    # The password policy is the realm's, and reading it is the registrar's
    # to allow. A caller who may not is shown the rest of the screen with the
    # password part marked unreadable, and cannot then write it: a form that
    # showed zeros would be saved as "no policy".
    try:
        realm = await _realm_password_policy(settings, name, token)
    except HTTPException:
        # No registrar configured, or it cannot be reached: unreadable, like
        # a refusal, and the rest of the screen still answers.
        realm = Response(status_code=503)
    if realm.status_code == 200:
        flat.update(_password_flat(json.loads(realm.body).get("passwordPolicy") or ""))
        flat["passwordPolicyReadable"] = True
    else:
        flat.update(_password_flat(""))
        flat["passwordPolicyReadable"] = False
    return Response(content=json.dumps(flat), status_code=200, media_type="application/json")


@router.put("/security-policies")
async def set_security_policies(
    body: dict,
    tenant: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    _user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Two writes, each by the service that owns what is written.

    The password parts are the registrar's action on the realm, and take
    effect at once. Sessions and lockout are declared state: the director
    answers a commit, Argo CD applies it and the composition writes it onto
    the realm.

    The password policy first, and the commit only if that was accepted, so a
    refusal leaves nothing half changed. It is written only when the form
    carries password parts and one of them differs from what the realm has.
    """
    if body.get("requireTotpAdmins") or body.get("requireTotpMembers", "none") != "none":
        raise HTTPException(status_code=400, detail=TOTP_NOT_SETTABLE)
    name = _tenant(settings, tenant)
    token = bearer_of(credentials)

    if any(field in body for field in _PASSWORD_FIELDS):
        realm = await _realm_password_policy(settings, name, token)
        if realm.status_code != 200:
            return realm
        current = json.loads(realm.body).get("passwordPolicy") or ""
        wanted = _password_policy(current, body)
        if wanted != current:
            answer = await director.forward_to(
                director.registrar_url(settings),
                "POST",
                f"/v1/tenants/{name}/actions/set-password-policy",
                token,
                json_body={"passwordPolicy": wanted},
            )
            if answer.status_code >= 300:
                return answer

    return await director.forward(
        settings,
        "PUT",
        f"/v1/tenants/{name}/security-policy",
        token,
        json_body=_nested(body),
    )
