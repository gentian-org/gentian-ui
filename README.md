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
frontend/
  design-system/  Brand tokens (gentian-theme.css)
  public/fonts/   Self-hosted webfonts
  public/tiles/   App launcher icons
  public/branding/ Logo
  src/auth/       OIDC stubs
  src/shell/      App menu, background, launcher
chart/            Kernel Helm chart (portal.<domain>)
legacy/           Archived reference only — never imported at runtime
```

## Related

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — target shell behaviour
- [docs/FRONTEND-STACK.md](docs/FRONTEND-STACK.md) — why React
- [docs/AGENTS.md](docs/AGENTS.md) — conventions for coding agents
