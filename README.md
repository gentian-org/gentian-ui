# Gentian UI

The platform's own user interfaces: the components every tenant gets from the
platform itself rather than from a catalogue. Each is an app in the gentian-apps
layout (`apps/<name>/` with `backend/`, `frontend/`, `chart/`, `docs/`), built
and published by its own workflow, and installed by the gentian-os operator from
a ComponentProfile the gentian-os chart ships.

| App | What it is | Images and chart |
|-----|------------|------------------|
| [`apps/desktop`](apps/desktop/README.md) | The desktop: sign-in, launcher, window host — what every person sees | `gentian-portal-{api,web}`, chart `gentian-portal` (`.github/workflows/desktop.yaml`) |
| [`apps/admin-console`](apps/admin-console/README.md) | The administration console, a client of the director, shown as a tile to administrators | `admin-console-{api,web}`, chart `admin-console` (`.github/workflows/admin-console.yaml`) |
| [`apps/sign-in`](apps/sign-in/README.md) | The sign-in router on `id.<kernel>/sign-in/`: an e-mail address in, its workspace's console out. Not a component; gentian-os runs it beside the identity provider | `sign-in-web`, no chart (`.github/workflows/sign-in.yaml`) |

Charts go to `oci://ghcr.io/gentian-org/charts` from `develop`, as
`<version>-develop.<sha>` (immutable) and `<version>-develop` (moving).

No `profile/` in either app: the profiles live in gentian-os, with the platform
that installs them. See [AGENTS.md](AGENTS.md) for conventions.
