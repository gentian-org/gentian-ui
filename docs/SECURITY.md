# Security conventions — gentian-ui (kernel shell)

Implements the same mandatory controls as
[gentian-app-template/docs/SECURITY.md](https://github.com/gentian-org/gentian-app-template/blob/main/docs/SECURITY.md).
Read that document for the full M1–M27 checklist; this file maps template modules
to this repo and notes kernel-specific deployment differences.

## Template parity (implemented here)

| Requirement | Location |
|-------------|----------|
| M1–M3 OIDC + JWT | `backend/app/core/auth.py`, `frontend/src/auth/` |
| M4 tenant context | `backend/app/core/tenant.py` (JWT claims, not `TENANT_ID` env) |
| M7 log redaction | `backend/app/core/logging_middleware.py` |
| M8 health probes | `backend/app/api/routes/health.py` |
| M9 CORS | `backend/app/core/config.py`, `chart/values.yaml` |
| M11–M13 pod hardening | `chart/templates/_helpers.tpl` |
| M16–M17 Gateway API | `chart/templates/httproute.yaml` |
| M22 / S1 OpenFGA stub | `backend/app/core/authz.py`, `openfga_client.py` |
| M26 DB scoping stub | `backend/app/db/session.py` |
| M27 resource limits | `chart/values.yaml`, `values-production.yaml.example` |
| Frontend bearer token | `frontend/src/api/client.ts` |
| Protected shell routes | `frontend/src/auth/RequireAuth.tsx`, `router.tsx` |

## Kernel-specific differences

| Topic | Catalogue app (template) | Kernel shell (this repo) |
|-------|--------------------------|---------------------------|
| Deploy | AppProfile + tenant install | `gentian-os` ApplicationSet |
| Gateway | Tenant Gateway | `kernel-public-gateway` in `gentian-kernel` |
| Host | `{subDomain}.{tenantDomain}` | `portal.{kernelDomain}` |
| Identity env | `TENANT_ID`, `TENANT_NAMESPACE` | `KERNEL_DOMAIN` |
| RBAC | Optional namespace Role | ClusterRole for catalogue APIs (`rbac.create: true`) |
| No `profile/` | — | Correct — not a catalogue app |

## Local dev

Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` →
`frontend/.env.local`, or use `docker-compose.dev.yaml` which sets
`AUTH_DISABLED=true` and `VITE_AUTH_DISABLED=true`.

## Related

- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — shell UX and API surface
- [gentian-os/docs/design/new-security-architecture.md](https://github.com/gentian-org/gentian-os/blob/main/docs/design/new-security-architecture.md)
