"""Backup tab API — TenantExport lifecycle through the Admin Console."""

from typing import Any

import pytest
from kubernetes.client.rest import ApiException
from httpx import ASGITransport, AsyncClient

from app.api.routes import admin as admin_routes
from app.main import app
from app.services import k8s_backup


class FakeCluster:
    """Stands in for the Kubernetes API.

    The BFF's whole job here is translating an admin's choice into a
    TenantExport plus, for a passphrase, a Secret — so what the tests care
    about is exactly what would have been sent.
    """

    def __init__(self) -> None:
        self.exports: list[dict[str, Any]] = []
        self.secrets: dict[str, str] = {}
        self.destination_keys: dict[str, tuple[str, str]] = {}
        self.fail_create = False

    def list_exports(self, tenant: str) -> list[dict[str, Any]]:
        return list(self.exports)

    def get_export(self, tenant: str, name: str) -> dict[str, Any] | None:
        for item in self.exports:
            if item["metadata"]["name"] == name:
                return item
        return None

    def create_export(
        self,
        tenant: str,
        name: str,
        *,
        apps: list[str] | None = None,
        encryption: dict[str, Any] | None = None,
        destination: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.fail_create:
            raise RuntimeError("apiserver unavailable")
        spec: dict[str, Any] = {}
        if apps:
            spec["apps"] = apps
        if encryption:
            spec["encryption"] = encryption
        if destination:
            spec["destination"] = destination
        item = {
            "metadata": {"name": name, "namespace": f"tenant-{tenant}", "creationTimestamp": "2026-08-18T03:00:00Z"},
            "spec": spec,
            "status": {"phase": "Pending"},
        }
        self.exports.append(item)
        return item

    def create_destination_secret(
        self, tenant: str, export_name: str, access_key: str, secret_key: str
    ) -> str:
        self.destination_keys[export_name] = (access_key, secret_key)
        return f"tenant-export-destination-keys-{export_name}"

    def delete_destination_secret(self, tenant: str, export_name: str) -> None:
        self.destination_keys.pop(export_name, None)

    def create_passphrase_secret(self, tenant: str, export_name: str, passphrase: str) -> str:
        name = k8s_backup.passphrase_secret_name(export_name)
        self.secrets[name] = passphrase
        return name

    def delete_passphrase_secret(self, tenant: str, export_name: str) -> None:
        self.secrets.pop(k8s_backup.passphrase_secret_name(export_name), None)

    def delete_export(self, tenant: str, name: str) -> bool:
        for i, item in enumerate(self.exports):
            if item["metadata"]["name"] == name:
                del self.exports[i]
                return True
        return False


@pytest.fixture
def cluster(monkeypatch) -> FakeCluster:
    fake = FakeCluster()
    monkeypatch.setattr(admin_routes, "list_exports", fake.list_exports)
    monkeypatch.setattr(admin_routes, "get_export", fake.get_export)
    monkeypatch.setattr(admin_routes, "create_export", fake.create_export)
    monkeypatch.setattr(admin_routes, "create_destination_secret", fake.create_destination_secret)
    monkeypatch.setattr(admin_routes, "delete_destination_secret", fake.delete_destination_secret)
    monkeypatch.setattr(admin_routes, "create_passphrase_secret", fake.create_passphrase_secret)
    monkeypatch.setattr(admin_routes, "delete_passphrase_secret", fake.delete_passphrase_secret)
    monkeypatch.setattr(admin_routes, "delete_export", fake.delete_export)
    return fake


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_default_export_uses_the_platform_key(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post("/api/v1/admin/backups", json={"name": "nightly", "apps": []})
        assert response.status_code == 201, response.text

    assert cluster.exports[0]["spec"]["encryption"] == {"mode": "recipient"}
    # Nothing to keep safe, which is what makes this the mode a schedule uses.
    assert cluster.secrets == {}


@pytest.mark.asyncio
async def test_passphrase_never_reaches_the_export_spec(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "my-copy",
                "apps": [],
                "encryption": {"mode": "passphrase", "passphrase": "correct horse battery"},
            },
        )
        assert response.status_code == 201, response.text

    spec = cluster.exports[0]["spec"]
    encryption = spec["encryption"]

    # The spec references a Secret; it must not carry the passphrase itself,
    # which would put it in etcd and in every `kubectl get -o yaml`.
    assert encryption["mode"] == "passphrase"
    assert encryption["passphraseSecretRef"]["name"] == "tenant-export-passphrase-my-copy"
    assert "passphrase" not in encryption
    assert "correct horse battery" not in str(spec)

    assert cluster.secrets["tenant-export-passphrase-my-copy"] == "correct horse battery"


@pytest.mark.asyncio
async def test_passphrase_mode_requires_a_passphrase(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={"name": "no-secret", "apps": [], "encryption": {"mode": "passphrase"}},
        )
        assert response.status_code == 400

    assert cluster.exports == []


@pytest.mark.asyncio
async def test_short_passphrase_is_rejected_before_it_reaches_the_cluster(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={"name": "weak", "apps": [], "encryption": {"mode": "passphrase", "passphrase": "short"}},
        )
        assert response.status_code == 422

    assert cluster.exports == []
    assert cluster.secrets == {}


@pytest.mark.asyncio
async def test_a_failed_create_does_not_strand_the_passphrase(cluster: FakeCluster):
    """A Secret left behind would sit in the namespace with nothing to consume
    or clean it up — a passphrase with no export attached to it."""
    cluster.fail_create = True

    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "doomed",
                "apps": [],
                "encryption": {"mode": "passphrase", "passphrase": "correct horse battery"},
            },
        )
        assert response.status_code == 503

    assert cluster.secrets == {}


@pytest.mark.asyncio
async def test_invalid_names_are_refused(cluster: FakeCluster):
    async with await _client() as client:
        for name in ["Nightly", "with space", "-leading", "x" * 41]:
            response = await client.post("/api/v1/admin/backups", json={"name": name, "apps": []})
            assert response.status_code in (400, 422), f"{name} was accepted"

    assert cluster.exports == []


@pytest.mark.asyncio
async def test_status_surfaces_progress_and_who_can_decrypt(cluster: FakeCluster):
    cluster.exports.append(
        {
            "metadata": {"name": "done", "namespace": "tenant-demo", "creationTimestamp": "2026-08-18T03:00:00Z"},
            "spec": {},
            "status": {
                "phase": "Ready",
                "startedAt": "2026-08-18T03:00:05Z",
                "completedAt": "2026-08-18T03:04:00Z",
                "bundle": {"bucket": "demo-gentian-backup", "prefix": "done"},
                "encryption": {"mode": "passphrase", "platformReadable": False},
                "quiesced": [],
                "apps": [
                    {
                        "name": "nextcloud-base-ce",
                        "phase": "Ready",
                        "stores": ["postgres", "volume"],
                        "chartVersion": "9.0.4",
                        "quiesceStart": "2026-08-18T03:00:10Z",
                        "quiesceEnd": "2026-08-18T03:02:10Z",
                    }
                ],
                "conditions": [{"type": "Complete", "status": "True", "message": "1 app(s) captured"}],
            },
        }
    )

    async with await _client() as client:
        response = await client.get("/api/v1/admin/backups/done")
        assert response.status_code == 200, response.text
        body = response.json()

    assert body["phase"] == "Ready"
    assert body["bundlePrefix"] == "done"
    assert body["encryptionMode"] == "passphrase"
    # The console tells the admin nobody else can open this. Getting it wrong
    # in either direction misleads them about what recovery is possible.
    assert body["platformReadable"] is False
    assert body["message"] == "1 app(s) captured"
    assert body["apps"][0]["stores"] == ["postgres", "volume"]


@pytest.mark.asyncio
async def test_missing_export_is_a_404(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.get("/api/v1/admin/backups/absent")
        assert response.status_code == 404


def test_export_names_must_be_dns_safe():
    assert k8s_backup.valid_export_name("export-2026-08-18")
    assert k8s_backup.valid_export_name("a")
    assert not k8s_backup.valid_export_name("Export")
    assert not k8s_backup.valid_export_name("has space")
    assert not k8s_backup.valid_export_name("-leading")
    assert not k8s_backup.valid_export_name("trailing-")
    assert not k8s_backup.valid_export_name("x" * 41)


def _seed_export(cluster: FakeCluster, name: str, phase: str) -> None:
    cluster.exports.append(
        {
            "metadata": {"name": name, "namespace": "tenant-demo"},
            "spec": {},
            "status": {"phase": phase},
        }
    )


@pytest.mark.asyncio
async def test_terminal_backups_delete_without_force(cluster: FakeCluster):
    _seed_export(cluster, "old-failed", "Failed")
    async with await _client() as client:
        resp = await client.delete("/api/v1/admin/backups/old-failed")
    assert resp.status_code == 204
    assert cluster.get_export("demo", "old-failed") is None


@pytest.mark.asyncio
async def test_deleting_a_running_backup_needs_force(cluster: FakeCluster):
    """A running export being deleted is an abort: paused apps get resumed and
    the partial bundle is removed. Deliberate enough to require force=true,
    not just a second click on the same button."""
    _seed_export(cluster, "in-flight", "Running")
    async with await _client() as client:
        refused = await client.delete("/api/v1/admin/backups/in-flight")
        assert refused.status_code == 409
        assert cluster.get_export("demo", "in-flight") is not None

        forced = await client.delete("/api/v1/admin/backups/in-flight", params={"force": "true"})
        assert forced.status_code == 204
    assert cluster.get_export("demo", "in-flight") is None


@pytest.mark.asyncio
async def test_deleting_a_missing_backup_is_a_404(cluster: FakeCluster):
    async with await _client() as client:
        resp = await client.delete("/api/v1/admin/backups/never-existed")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_no_destination_means_the_policy_and_says_nothing(cluster: FakeCluster):
    """The default writes no destination at all.

    A spec that always carried `destination: {mode: policy}` would say the same
    thing as one that carried nothing, and invite whoever reads it to wonder
    what was overridden.
    """
    async with await _client() as client:
        response = await client.post("/api/v1/admin/backups", json={"name": "nightly", "apps": []})
        assert response.status_code == 201, response.text

    assert "destination" not in cluster.exports[0]["spec"]


@pytest.mark.asyncio
async def test_platform_target_needs_no_endpoint_and_no_keys(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={"name": "before-upgrade", "apps": [], "destination": {"mode": "platform"}},
        )
        assert response.status_code == 201, response.text

    assert cluster.exports[0]["spec"]["destination"] == {"mode": "platform"}
    assert cluster.destination_keys == {}


@pytest.mark.asyncio
async def test_s3_with_the_managed_credential_stores_no_keys(cluster: FakeCluster):
    """The point of the managed source: a different bucket, nobody retyping a secret."""
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "one-off",
                "apps": [],
                "destination": {
                    "mode": "custom",
                    "endpoint": "https://sos-ch-gva-2.exo.io",
                    "bucket": "elsewhere",
                    "region": "ch-gva-2",
                    "credentialSource": "managed",
                },
            },
        )
        assert response.status_code == 201, response.text

    spec = cluster.exports[0]["spec"]["destination"]
    assert spec["credentialSource"] == "managed"
    assert spec["endpoint"] == "https://sos-ch-gva-2.exo.io"
    # No Secret was written, and none is referenced: the operator authenticates
    # with what the Credential Manager already holds.
    assert "credentialSecretRef" not in spec
    assert cluster.destination_keys == {}


@pytest.mark.asyncio
async def test_transient_keys_become_a_secret_the_spec_only_names(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "handover",
                "apps": [],
                "destination": {
                    "mode": "custom",
                    "endpoint": "https://s3.example.org",
                    "credentialSource": "transient",
                    "accessKey": "AKIAEXAMPLE",
                    "secretKey": "s3cr3t-value",
                },
            },
        )
        assert response.status_code == 201, response.text

    spec = cluster.exports[0]["spec"]["destination"]
    assert spec["credentialSecretRef"] == "tenant-export-destination-keys-handover"
    assert cluster.destination_keys["handover"] == ("AKIAEXAMPLE", "s3cr3t-value")
    # The keys reach the cluster as a Secret and never as spec fields, for the
    # reason the passphrase does: a spec is readable by anyone who can read the
    # resource, and object storage keys in a manifest are keys in every backup
    # of etcd.
    assert "accessKey" not in spec
    assert "secretKey" not in spec


@pytest.mark.asyncio
async def test_a_custom_target_without_an_endpoint_is_refused(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={"name": "nowhere", "apps": [], "destination": {"mode": "custom"}},
        )
        assert response.status_code == 400, response.text

    assert cluster.exports == []


@pytest.mark.asyncio
async def test_transient_without_keys_is_refused_before_anything_is_created(cluster: FakeCluster):
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "half",
                "apps": [],
                "destination": {
                    "mode": "custom",
                    "endpoint": "https://s3.example.org",
                    "credentialSource": "transient",
                    "accessKey": "AKIAEXAMPLE",
                },
            },
        )
        assert response.status_code == 400, response.text

    assert cluster.exports == []
    assert cluster.destination_keys == {}


@pytest.mark.asyncio
async def test_a_failed_export_takes_its_transient_keys_with_it(cluster: FakeCluster):
    """Otherwise the keys sit in the namespace with no export to consume them."""
    cluster.fail_create = True
    async with await _client() as client:
        response = await client.post(
            "/api/v1/admin/backups",
            json={
                "name": "doomed",
                "apps": [],
                "destination": {
                    "mode": "custom",
                    "endpoint": "https://s3.example.org",
                    "credentialSource": "transient",
                    "accessKey": "AKIAEXAMPLE",
                    "secretKey": "s3cr3t-value",
                },
            },
        )
        assert response.status_code == 503, response.text

    assert cluster.destination_keys == {}


def test_reusing_a_backup_name_replaces_the_secret_without_update(monkeypatch):
    """The portal holds create, get and delete on tenant Secrets — not update.

    Reusing a backup name is the normal case, not an edge one: the console
    offers a name derived from the clock, so a retry inside the same minute
    proposes the same name and finds the previous attempt's Secret. Replacing it
    with an update failed with a 403 that named the portal's ServiceAccount and
    told the person nothing they could act on.
    """
    from app.services import k8s_backup

    calls: list[str] = []

    class FakeCoreApi:
        def create_namespaced_secret(self, namespace, body):
            calls.append("create")
            # The first create collides with the leftover; the second succeeds.
            if calls.count("create") == 1:
                raise ApiException(status=409, reason="AlreadyExists")

        def delete_namespaced_secret(self, name, namespace):
            calls.append("delete")

        def replace_namespaced_secret(self, name, namespace, body):
            calls.append("replace")
            raise AssertionError(
                "replace needs the update verb, which the portal is not granted"
            )

    monkeypatch.setattr(k8s_backup, "_core_api", lambda: FakeCoreApi())
    name = k8s_backup.create_passphrase_secret("corp", "export-2026-09-02-19-54", "hunter2hunter2")

    assert name == "tenant-export-passphrase-export-2026-09-02-19-54"
    assert calls == ["create", "delete", "create"], (
        f"expected create → delete → create using only the verbs the portal has, got {calls}"
    )
