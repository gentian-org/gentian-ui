# Desktop

The desktop of Gentian OS — login hub, desktop/mobile bases, app launcher, and
iframe window host. One of the two apps in gentian-ui; the administration
console is the other (`../admin-console`). Canonical scaffold for Gentian-built UI — same stack as
[gentian-app-template](https://github.com/gentian-org/gentian-app-template)
(catalogue apps and kernel shell).

## What it does, and what it does not

The desktop is a relay for tiles. It shows what the signed-in person may open
— the tiles the usher answers for them — and opens it, and it keeps that
person's own preferences. It installs nothing, removes nothing, grants
nothing and reads no catalogue: administering apps is the administration
console's (its Apps tab), and nothing an ordinary member could interfere with
is reachable from here. An App Store, on a cluster that has one, is an app of
its own and arrives as a tile like any other; the desktop has no special
handling for it.

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
- [../../AGENTS.md](../../AGENTS.md) — conventions for coding agents

## Layout

An app directory in the gentian-apps layout (`apps/<name>/`), so that the
desktop and the console sit side by side in the same shape and either could
move to a repository of its own as a move of files and nothing else:

```
backend/          FastAPI — who is signed in, their tiles (from the usher), their preferences
frontend/         React SPA — Vite, TanStack Router/Query, Zustand, Tailwind
chart/            Helm — api + web Deployments, no RBAC, no mounted token
docs/             SECURITY.md, FRONTEND-STACK.md, architecture.md, ai-widget.md
```

No `profile/`. The desktop's ComponentProfile lives in the gentian-os chart
(`charts/gentian-os/templates/componentprofile-desktop.yaml`), because the
platform installs the desktop for every tenant itself rather than offering it
in a catalogue — gentian-apps' `apps/_template/README.md` states this exception. One
declaration, in the repository that does the installing.
