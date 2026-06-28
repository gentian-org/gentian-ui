# AGENTS.md — Gentian shell development

Same conventions as [gentian-app-template/docs/AGENTS.md](https://github.com/gentian-org/gentian-app-template/blob/main/docs/AGENTS.md).
This repo is the **kernel shell** instance of the shared stack.

## Directory map

| Path | Purpose |
|------|---------|
| `backend/app/main.py` | FastAPI entrypoint |
| `backend/app/core/config.py` | Settings from environment |
| `backend/app/core/auth.py` | OIDC JWT validation |
| `backend/app/core/authz.py` | ReBAC PEP hook |
| `backend/app/api/routes/` | HTTP routers |
| `frontend/src/pages/` | Login, Desktop, Mobile |
| `frontend/src/shell/` | App menu, background, user menu |
| `frontend/src/windows/` | Window manager |
| `frontend/src/stores/` | Zustand client state |
| `frontend/src/api/` | Backend fetch helpers |
| `frontend/src/router.tsx` | TanStack Router |
| `chart/` | Kernel Helm (Gateway API HTTPRoute) |
| `legacy/` | Archived Vue/Nubus code — reference only |

## Local dev

```bash
docker compose -f docker-compose.dev.yaml up --build
```

See [docs/SECURITY.md](./SECURITY.md) and [docs/ARCHITECTURE.md](./ARCHITECTURE.md).
