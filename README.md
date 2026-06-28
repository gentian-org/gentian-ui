# Gentian UI

Kernel shell for Gentian OS — login hub, desktop/mobile bases, app launcher, and
iframe window host. Canonical scaffold for Gentian-built UI — same stack as
[gentian-app-template](https://github.com/gentian-org/gentian-app-template)
(catalogue apps and kernel shell).

## Quick start

```bash
docker compose -f docker-compose.dev.yaml up --build
```

- Shell UI: http://localhost:5173
- API docs: http://localhost:8000/docs

Local dev uses `AUTH_DISABLED=true` and `VITE_AUTH_DISABLED=true` (see
`backend/.env.example`, `frontend/.env.example`, or `docker-compose.dev.yaml`).

## Layout

```
backend/          shell-api (FastAPI) — same modules as gentian-app-template
frontend/         React SPA (Vite + TanStack Router + Query + Zustand)
  src/auth/       OIDC stubs (AuthProvider, RequireAuth, bearer client)
chart/            Kernel Helm chart (portal.<domain>)
design-system/    → legacy/design-system (tokens, tiles, UI kits)
docs/             AGENTS.md, SECURITY.md, FRONTEND-STACK.md, ARCHITECTURE.md
legacy/           Archived Vue/Nubus codebase (reference only)
```

## Related

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — target shell behaviour
- [docs/FRONTEND-STACK.md](docs/FRONTEND-STACK.md) — why React
- [docs/AGENTS.md](docs/AGENTS.md) — conventions for coding agents
