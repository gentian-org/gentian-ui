# AGENTS.md — Gentian shell development

Dogfoods [gentian-app-template](https://github.com/gentian-org/gentian-app-template) —
same backend/frontend/chart layout and security modules. This repo is the **kernel
shell** instance; see template `docs/AGENTS.md` for catalogue-app specifics
(`profile/`, AppProfile publish flow).

## Directory map

| Path | Purpose |
|------|---------|
| `backend/app/main.py` | FastAPI entrypoint |
| `backend/app/core/config.py` | Settings from environment |
| `backend/app/core/auth.py` | OIDC JWT validation |
| `backend/app/core/tenant.py` | JWT tenant/realm context (kernel multi-realm) |
| `backend/app/core/authz.py` | ReBAC PEP hook (OpenFGA / AuthZEN) |
| `backend/app/core/logging_middleware.py` | M7 log redaction |
| `backend/app/db/session.py` | Tenant-scoped DB session stub |
| `backend/app/api/routes/` | HTTP routers (`session`, `apps`, `prefs`) |
| `frontend/src/auth/` | OIDC provider, RequireAuth, token helpers |
| `frontend/src/pages/` | Login, Desktop, Mobile |
| `frontend/src/shell/` | App menu, background, user menu |
| `frontend/src/windows/` | Window manager |
| `frontend/src/stores/` | Zustand client state |
| `frontend/src/api/client.ts` | Typed fetch + Bearer token |
| `frontend/src/router.tsx` | TanStack Router |
| `chart/` | Kernel Helm (Gateway API HTTPRoute) |
| `legacy/` | Archived Vue/Nubus code — reference only |

## Add an API endpoint

1. Create `backend/app/api/routes/<feature>.py` with an `APIRouter`.
2. Register it in `backend/app/main.py`.
3. Protect routes with `Depends(get_current_user)`.
4. Use `check_permission()` or `require_permission()` for sensitive ops (M22).

## Add a React page

1. Add component under `frontend/src/pages/`.
2. Register route in `frontend/src/router.tsx` under the `shell` layout if auth required.
3. Load server data with TanStack Query via `api/client.ts`.
4. Use Zustand in `frontend/src/stores/` for local UI state.

## Edge routing

Production uses **Gateway API** (`chart/templates/httproute.yaml`) on
`kernel-public-gateway`. Routes `/api`, `/healthz`, `/readyz` → API; `/` → web.
See [docs/SECURITY.md](./SECURITY.md).

## Local dev

```bash
docker compose -f docker-compose.dev.yaml up --build
```

- UI: http://localhost:5173
- API: http://localhost:8000/docs

`AUTH_DISABLED=true` and `VITE_AUTH_DISABLED=true` skip OIDC locally.

See [docs/SECURITY.md](./SECURITY.md) and [docs/ARCHITECTURE.md](./ARCHITECTURE.md).
