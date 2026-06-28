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

Local dev uses `AUTH_DISABLED=true` (no Keycloak required).

## Layout

```
backend/          shell-api (FastAPI)
frontend/         React SPA (Vite + TanStack Router + Query + Zustand)
chart/            Kernel Helm chart (portal.<domain>)
design-system/    → legacy/design-system (tokens, tiles, UI kits)
docs/             AGENTS.md, FRONTEND-STACK.md, ARCHITECTURE.md
legacy/           Archived Vue/Nubus codebase (reference only)
```

## Related

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — target shell behaviour
- [docs/FRONTEND-STACK.md](docs/FRONTEND-STACK.md) — why React
- [docs/AGENTS.md](docs/AGENTS.md) — conventions for coding agents
