# Security conventions for Gentian apps

This template implements the **application-layer** slice of
[gentian-os/docs/security/design.md](https://github.com/gentian-org/gentian-os/blob/main/docs/security/design.md).
Platform MAC (namespaces, NetworkPolicy, the edge in both directions) is
enforced by Gentian OS; apps must not weaken it. The edge is described in
[gentian-os/docs/concepts/edge.md](https://github.com/gentian-org/gentian-os/blob/develop/docs/concepts/edge.md).

---

## Mandatory requirements (every app)

These are **non-negotiable** for any Gentian first-party app (catalog or kernel).
CI and catalog review should fail if any are missing.

### Authentication

| # | Requirement | How |
|---|-------------|-----|
| M1 | **Validate OIDC bearer tokens on every user-facing API route** | `Depends(get_current_user)` on all `/api/v1/*` handlers that return or mutate tenant/user data |
| M2 | **`AUTH_DISABLED` only in local dev** | Must be `false` in cluster; chart sets it from `auth.disabled: false` |
| M3 | **Validate JWT issuer, signature, and expiry** | Use `gentian_app_runtime.auth` — do not roll custom token parsing |
| M4 | **Scope operations to the authenticated tenant** | Read `TENANT_ID` / claims; never trust client-supplied tenant IDs without matching the token |

Public unauthenticated endpoints are limited to **`/healthz`** and **`/readyz`** only.

### Secrets

| # | Requirement | How |
|---|-------------|-----|
| M5 | **Pattern A — no secrets in Git or Helm values** | Chart uses `existingSecret` + `envFrom`; credentials come from ESO/OpenBao |
| M6 | **No secrets in ConfigMaps, env literals, or AppProfile** | Only `valueMapping` key names in profile; values injected at deploy time |
| M7 | **No logging of tokens, passwords, or connection strings** | Redact `Authorization` headers in logs |

### API surface

| # | Requirement | How |
|---|-------------|-----|
| M8 | **Expose `/healthz` (liveness) and `/readyz` (readiness)** | Unauthenticated; wired to Deployment probes |
| M9 | **Explicit CORS in production** | `BACKEND_CORS_ORIGINS` set to the app’s HTTPS origin(s) — never `*` on tenant apps |
| M10 | **HTTPS only at the edge** | App listens on HTTP inside the cluster; TLS terminates at Envoy Gateway |

### Workload hardening (chart)

| # | Requirement | How |
|---|-------------|-----|
| M11 | **Run as non-root** | `podSecurity.runAsNonRoot: true`, `runAsUser: 65532` |
| M12 | **Drop all capabilities, no privilege escalation** | `containerSecurityContext` in chart templates |
| M13 | **Read-only root filesystem** | Writable paths only via `emptyDir` (e.g. `/tmp`) |
| M14 | **No privileged containers or hostPath** | Admission will reject; do not request exceptions in chart |
| M15 | **Pin container image tags** | Semver or digest in `chart/values.yaml` — no floating `latest` in production |

### Edge routing

| # | Requirement | How |
|---|-------------|-----|
| M16 | **Routes come from the profile's `expose` entries** | The operator writes the HTTPRoutes from the profile's `expose[]`; in the cluster the chart's own `chart/templates/httproute.yaml` stays off (`gateway.enabled: false`). No nginx Ingress, no in-pod reverse proxy |
| M17 | **Split API and static web at the gateway** | `/api`, `/healthz`, `/readyz` → API Service; `/` → web Service: two `expose` entries on one host (`surface: gateway`, `authMode: oidc`) |

### Catalog declaration (catalog apps only)

Integration **contracts** are how Gentian declares what an app offers and what it
can use from other apps. This is already in the `AppProfile` CRD — not a separate
`consumes` / `publishes` block.

| Security architecture term | AppProfile CRD field | Meaning |
|---|---|---|
| *publishes* (manifest) | `spec.provides` | Contract names this app **provides** (e.g. `project-management`) |
| *consumes* (manifest) | `spec.optionalIntegrations` | Contract names this app **may consume**, with optional `capabilities` |

Contract **schemas** live in `gentian-apps/contracts/` (when present). The profile
only references contract **names** that match those definitions.

**Three layers — do not confuse them:**

| Layer | What | Who authors | Today |
|---|---|---|---|
| **Declaration** | `provides` + `optionalIntegrations` on AppProfile | Catalog / app developer | **Implemented** (CRD) |
| **Wiring** | `IntegrationBinding` — credentials + OIDC between installed apps | Platform operator (auto when peers match) | **Implemented** |
| **Grant (ReBAC)** | `AppGrant` — the capabilities the tenant approved for a consumer, a subset of what the binding declares; the director projects it into OpenFGA | Tenant admin, after install | **Implemented** |

`kernelRequirements` (OIDC, Postgres, S3, …) is **separate** — it declares
**kernel services**, not cross-app integration contracts.

| # | Requirement | How |
|---|-------------|-----|
| M18 | **Declare kernel needs honestly** | `kernelRequirements` — only OIDC/DB/storage/mail the app actually uses |
| M19 | **Declare integration contracts honestly** | `provides` / `optionalIntegrations` — only contracts the app implements or consumes; see existing profiles under `gentian-apps/profiles/` |
| M20 | **Never implement tenant grants in app code** | Cross-app access is wired by `IntegrationBinding` and narrowed by `AppGrant`; who may use an app, and with which role, is the roles people hold on it through positions in the platform's rights store ([gentian-os iam.md §1.2](https://github.com/gentian-org/gentian-os/blob/develop/docs/concepts/iam.md)) — apps declare, they do not grant |

The admin console's profile is the platform's, not this repository's: the
`ComponentProfile` `admin-console` in gentian-os
(`charts/gentian-os/templates/componentprofile-admin-console.yaml`). M18–M20
are checked there.

---

## Mandatory when applicable

Enable these when the condition is true — not optional laziness.

| Condition | Requirement |
|-----------|-------------|
| App calls **Kubernetes or Gentian APIs** | M21: Dedicated **ServiceAccount** + **Role/RoleBinding** (or ClusterRole if cross-namespace) with **minimum verbs/resources**; `rbac.create: true` |
| App exposes **admin or destructive operations** | M22: **OpenFGA / AuthZEN `Check`** before the handler runs (via `require_permission()` once PDP is wired) |
| App runs **AI agents or workflows** | M23: **Dedicated Keycloak client per agent instance** — never reuse human credentials or a shared service account |
| App agents act **on behalf of a user** | M24: **RFC 8693 token exchange** with `act` / `may_act`; rights derived through user ceiling (§2.3) |
| App calls **hosts outside the cluster** | M25: Declare each destination in `requires.privileges.egress[]` with a `reason`, as `hosts`, `hostsAtApproval` or an address `rule` ([app-profile-guide.md](https://github.com/gentian-org/gentian-apps/blob/develop/docs/app-profile-guide.md)). Connect to the host by its name as usual: no proxy setting, no own NetworkPolicy, and never disable the platform's. The admin console calls no host outside the cluster |
| App stores **tenant/user data** | M26: **Row-level tenant isolation** in queries; no cross-tenant reads even if ReBAC is not wired yet |
| **Production** deploy | M27: **CPU/memory requests and limits** on api and web containers |

---

## Mandatory once platform Stage 2 is live

When OpenFGA is available in the cluster, these become mandatory for all apps
(not just admin apps):

| # | Requirement |
|---|-------------|
| S1 | Call OpenFGA **Check** (AuthZEN API) on every mutation and sensitive read |
| S2 | Effective access = `contract declaration ∩ tenant grant (AppGrant) ∩ the person's roles on the app ∩ ABAC` |
| S3 | Agent routes validate **delegation tuple + task TTL** before acting |

Until then, M1–M4 + M26 are the minimum authorization bar.

---

## Where this template implements each requirement

| Area | Path |
|------|------|
| JWT validation (M1–M4) | `gentian_app_runtime.auth`, `gentian_app_runtime.tenant` |
| Log redaction (M7) | `backend/app/core/logging_middleware.py` |
| Health probes (M8) | `backend/app/api/routes/health.py` |
| CORS (M9) | `backend/app/core/config.py`, `chart/values.yaml` |
| Origin check on POST/PUT/PATCH/DELETE (forged cross-site requests) | `gentian_app_runtime.origin_check` — the rule and what it leaves open are in its docstring; `CSRF_TRUSTED_ORIGINS` allow-lists further origins, empty by default |
| OpenFGA PEP stub (M22, S1) | `backend/app/core/authz.py`, `backend/app/core/openfga_client.py` |
| Tenant DB scoping (M26) | `backend/app/db/session.py` |
| Resource limits (M27) | `chart/values.yaml`, `chart/values-production.yaml.example` |
| Frontend OIDC + bearer (M1) | `frontend/src/auth/`, `frontend/src/api/client.ts` |
| Protected routes | `frontend/src/auth/RequireAuth.tsx`, `frontend/src/router.tsx` |

---

## Platform-provided — apps must NOT reimplement or weaken

These are **not** app author responsibilities. Do not duplicate or override them
in the chart unless platform docs explicitly require an app-specific supplement.

| Control | Owner |
|---------|--------|
| Per-tenant namespace isolation | Gentian OS / Crossplane |
| Tenant NetworkPolicy baseline: DNS to the cluster's DNS, the API server, what the profile declares inside the cluster; everything outside refused unless granted (Calico) | Gentian OS operator |
| The Gateways `authenticated`, `perimeter` and `inside` and their TLS certificates (cert-manager) | Gentian OS operator |
| The outgoing gateway: one listener per granted host, the caller's host-table entry, the record of each connection | Gentian OS operator |
| `frame-ancestors` / CSP for portal iframe embedding | Gentian OS gateway policy |
| Admission control (no privileged pods, image policy) | Kyverno / Gatekeeper |
| Keycloak realm, OIDC clients, token exchange infra | Kernel Keycloak config |
| OpenBao paths + ESO ExternalSecrets | Platform provisioning |
| HTTPRoute hostnames from the profile's `expose[].subDomain` | Gentian OS operator |

---

## Edge decisions in this console

The console shows and answers what the director allows; the director decides
again on every write and its refusal is shown as it came.

- **Perimeter** (for `can_expose`): the entries waiting for a decision and the
  published ones, the tenant's **Outbound** list, **Trusted domains**, the
  traffic of the published paths, and the history of each decision from its
  commit. Outbound lists every `egress/<name>` request of the tenant's apps,
  waiting or declined, with its reason and the hosts it names (or that the
  approval names them), and every grant with its approver, time, reason,
  the hosts it opens and its end. The tenant's perimeter approver
  (`can_approve_privilege`) approves or declines a request there and withdraws
  a grant; a withdrawn request waits for an answer again.
- **Trusted domains**: the tenant's own list, beside the cluster's. While the
  cluster's administrator has delegated the list to the tenant, the tenant's
  perimeter approver adds and removes domains. A request whose every host is
  in or under a trusted domain is granted without a further answer; removing
  the domain makes it wait again.
- **Approvals**: the requests a person answers: the cluster's approvers see
  every tenant's, the tenant's perimeter approver the tenant's own. An
  approval takes an optional comment and an optional end; a decline needs a
  reason of at least ten characters. For a `hostsAtApproval`
  request the approver names the hosts, one per line or comma-separated, with
  a port where it is not 443, and the grant opens those and no others.

---

## Checklist before merge / release

```text
[ ] M1–M4  OIDC on all data routes; tenant scoping
[ ] M5–M7  Pattern A secrets; no leakage in logs
[ ] M8–M10 Health probes; CORS; no in-app TLS termination
[ ] M11–M15 Pod hardening; pinned images
[ ] M16–M17 Routes from the profile's expose; no nginx
[ ] M18–M20 AppProfile honest declaration (catalog apps)
[ ] M21+    Conditional items reviewed
[ ] M27     Resource limits set for production
```

---

## Related

- [gentian-os/docs/concepts/app-catalog.md](https://github.com/gentian-org/gentian-os/blob/main/docs/concepts/app-catalog.md) — contracts, `provides`, `IntegrationBinding`
- [gentian-os/docs/security/design.md](https://github.com/gentian-org/gentian-os/blob/main/docs/security/design.md) §3.4 — same model as `provides`/`optionalIntegrations`, plus future AppGrant/ReBAC
- [gentian-os/docs/concepts/routing.md](https://github.com/gentian-org/gentian-os/blob/main/docs/concepts/routing.md)
- [gentian-os/docs/guides/edge.md](https://github.com/gentian-org/gentian-os/blob/develop/docs/guides/edge.md) — operating the edge: approvals, trusted domains, the record
- [gentian-os/docs/security/design.md](https://github.com/gentian-org/gentian-os/blob/main/docs/security/design.md)
