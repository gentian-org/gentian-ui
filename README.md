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
```

## Related

- [docs/architecture.md](docs/architecture.md) — target shell behaviour
- [docs/FRONTEND-STACK.md](docs/FRONTEND-STACK.md) — why React
- [AGENTS.md](AGENTS.md) — conventions for coding agents

## Layout

This repository is one component of the platform and follows the gentian-apps
app layout, so that moving it into `gentian-apps/apps/desktop/` or into a
repository of its own is a move of files and nothing else:

```
backend/          FastAPI — a router in front of the director, plus preferences
frontend/         React SPA — Vite, TanStack Router/Query, Zustand, Tailwind
chart/            Helm — api + web Deployments, no RBAC, no mounted token
docs/             AGENTS.md (at the root, because this is its own repository),
                  SECURITY.md, FRONTEND-STACK.md, architecture.md
```

No `profile/`. The desktop's ComponentProfile lives in the gentian-os chart
(`charts/gentian-os/templates/componentprofile-desktop.yaml`), because the
platform installs the desktop for every tenant itself rather than offering it
in a catalogue — `apps/_template/README.md` states this exception. One
declaration, in the repository that does the installing.
