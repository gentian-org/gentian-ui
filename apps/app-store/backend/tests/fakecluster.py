"""The cluster's services, for the tests: the director, the custodian and the
usher, as far as this app asks them.

Stands in where `app.core.director` opens its HTTP client. Every request is
kept in `calls`, with the bearer it carried, and answered the way the real
handlers answer -- the same statuses, the same bodies.
"""

from dataclasses import dataclass
from typing import Any

import httpx

DIRECTOR = "http://director.test:8080"
CUSTODIAN = "http://custodian.test:9444"
USHER = "http://usher.test:8081"


@dataclass
class Call:
    service: str
    method: str
    path: str
    json: Any
    bearer: str | None


class FakeCluster:
    def __init__(self, tenant: str) -> None:
        self.tenant = tenant
        self.calls: list[Call] = []
        self.relations = {"can_enter": True, "can_view": True, "can_install_app": True}
        self.app_store = {"available": True}
        self.repositories: dict[str, str] = {}  # name -> url, as git has them
        self.synced: set[str] = set()  # names the cluster has picked up
        self.sync_after = 0  # how many times the custodian answers 404 first
        self.credentials: dict[str, dict[str, str]] = {}
        self.apps: dict[str, dict[str, Any]] = {}
        self.states: dict[str, dict[str, Any]] = {}
        self.ready_on_install = True
        self.install_refusal: tuple[int, str] | None = None
        self.down: set[str] = set()  # services that cannot be reached

    def of(self, service: str, method: str | None = None) -> list[Call]:
        return [
            c for c in self.calls if c.service == service and (method is None or c.method == method)
        ]

    def order(self) -> list[str]:
        """The writes, in the order they were made."""
        return [f"{c.service} {c.method} {c.path}" for c in self.calls if c.method != "GET"]

    def handle(self, method: str, url: str, json: Any, headers: dict | None) -> httpx.Response:
        bearer = (headers or {}).get("Authorization")
        for service, base in (("director", DIRECTOR), ("custodian", CUSTODIAN), ("usher", USHER)):
            if url.startswith(base):
                path = url[len(base) :]
                if service in self.down:
                    raise httpx.ConnectError("refused", request=httpx.Request(method, url))
                self.calls.append(Call(service, method, path, json, bearer))
                status, body = getattr(self, f"_{service}")(method, path, json)
                return httpx.Response(status, json=body, request=httpx.Request(method, url))
        raise AssertionError(f"a request to somewhere that is not the cluster: {url}")

    # ── director ────────────────────────────────────────────────────────────

    def _director(self, method: str, path: str, body: Any) -> tuple[int, Any]:
        prefix = f"/v1/tenants/{self.tenant}"
        if (method, path) == ("GET", f"{prefix}/me"):
            return 200, {"tenant": self.tenant, "subject": "person", "relations": self.relations}
        if (method, path) == ("GET", f"{prefix}/apps"):
            return 200, {"tenant": self.tenant, "apps": list(self.apps.values())}
        if method == "PUT" and path.startswith(f"{prefix}/repositories/"):
            name = path.rsplit("/", 1)[1]
            held = self.repositories.get(name)
            if held is not None and held != body["url"] and body.get("confirm") != name:
                return 428, {
                    "error": f"repository {name} points at {held}; "
                    "re-pointing it changes where this tenant's apps are pulled from",
                    "confirmField": "confirm",
                    "confirmWith": name,
                    "dangerous": True,
                    "requiresRetype": True,
                    "request_id": "r-1",
                }
            answer = {
                "status": "declared",
                "name": name,
                "tenant": self.tenant,
                "role": body["role"],
                "credentialName": f"repository-{name}",
                "created": held is None,
            }
            if held == body["url"]:
                return 200, {**answer, "status": "unchanged"}
            self.repositories[name] = body["url"]
            return 202, {**answer, "commit": "c0ffee1", "message": "committed"}
        if method == "PUT" and path.startswith(f"{prefix}/apps/") and path.endswith("/addons"):
            profile = path.split("/")[-2]
            if profile not in self.apps:
                return 200, {"status": "not_installed"}
            names, pins = [], []
            for entry in body["addons"]:
                if isinstance(entry, str):
                    names.append(entry)
                else:
                    name = entry["coordinate"].split("/", 1)[1]
                    names.append(name)
                    pins.append({"name": name, "digest": entry["digest"], "catalogue": "gentian"})
            self.apps[profile]["addons"] = names
            self.apps[profile]["addonPins"] = pins
            return 202, {"status": "updated", "commit": "c0ffee3"}
        if method == "POST" and path.startswith(f"{prefix}/apps/"):
            profile = path.rsplit("/", 1)[1]
            if self.install_refusal is not None:
                status, text = self.install_refusal
                return status, {"error": text, "request_id": "r-2"}
            existing = self.apps.get(profile)
            entry = dict(existing or {"profile": profile})
            if "digest" in body:
                entry["digest"] = body["digest"]
            if body.get("defaultGrant") is True:
                entry["defaultGrant"] = True
            elif body.get("defaultGrant") is False:
                entry.pop("defaultGrant", None)
            if existing == entry:
                return 200, {"status": "already_installed"}
            self.apps[profile] = entry
            if self.ready_on_install:
                self.states[profile] = {
                    "profile": profile,
                    "name": profile,
                    "ready": True,
                    "phase": "ready",
                }
            return 202, {"status": "updated" if existing else "installed", "commit": "c0ffee2"}
        return 404, {"error": "not found", "request_id": "r-0"}

    # ── custodian ───────────────────────────────────────────────────────────

    def _custodian(self, method: str, path: str, body: Any) -> tuple[int, Any]:
        if method == "PUT" and path.startswith("/v1/credentials/repository-"):
            name = path.removeprefix("/v1/credentials/repository-")
            if name in self.repositories and name not in self.synced:
                if self.sync_after > 0:
                    self.sync_after -= 1
                else:
                    self.synced.add(name)
            if name not in self.synced:
                return 404, {"error": f'credential "repository-{name}" is not known'}
            self.credentials[name] = body["fields"]
            return 200, {
                "name": f"repository-{name}",
                "vaultPath": f"tenants/{self.tenant}/repositories/{name}",
                "stored": True,
                "setBy": "person",
            }
        return 404, {"error": "not found"}

    # ── usher ───────────────────────────────────────────────────────────────

    def _usher(self, method: str, path: str, _body: Any) -> tuple[int, Any]:
        prefix = f"/v1/tenants/{self.tenant}"
        if (method, path) == ("GET", f"{prefix}/apps/status"):
            return 200, {"tenant": self.tenant, "apps": list(self.states.values())}
        if (method, path) == ("GET", f"{prefix}/tiles"):
            return 200, {"tenant": self.tenant, "tiles": [], "appStore": self.app_store}
        return 404, {"error": "not found"}
