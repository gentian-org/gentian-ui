# Gentian UI

The platform's own user interfaces: the components every tenant gets from the
platform itself rather than from a catalogue. Each is an app in the gentian-apps
layout (`apps/<name>/` with `backend/`, `frontend/`, `chart/`, `docs/`), built
and published by its own workflow, and installed by the gentian-os operator from
a ComponentProfile the gentian-os chart ships.

| App | What it is | Images and chart |
|-----|------------|------------------|
| [`apps/desktop`](apps/desktop/README.md) | The desktop: sign-in, launcher, window host — what every person sees. A relay for tiles: it administers nothing | `gentian-portal-{api,web}`, chart `gentian-portal` (`.github/workflows/desktop.yaml`) |
| [`apps/admin-console`](apps/admin-console/README.md) | The administration console, a client of the director, shown as a tile to administrators. Where apps are administered (the Apps tab) | `admin-console-{api,web}`, chart `admin-console` (`.github/workflows/admin-console.yaml`) |
| [`apps/app-store`](apps/app-store/README.md) | The App Store app: the interface of a store outside the cluster. Renders the store's data and installs through the director and the custodian, for people who may install apps | `app-store-{api,web}`, chart `app-store` (`.github/workflows/app-store.yaml`) |
| [`apps/concierge`](apps/concierge/README.md) | The concierge, on `id.<kernel>/sign-in/`: an e-mail address in, its workspace's desktop out. Not a component; gentian-os runs it beside the identity provider | `concierge-web`, no chart (`.github/workflows/concierge.yaml`) |

Charts go to `oci://ghcr.io/gentian-org/charts` from `develop`, as
`<version>-develop.<sha>` (immutable) and `<version>-develop` (moving).

No `profile/` in either app: the profiles live in gentian-os, with the platform
that installs them. See [AGENTS.md](AGENTS.md) for conventions.

## License

MPL-2.0 — see [LICENSE](LICENSE). The notice of the license's Exhibit A is
given here for every file in the repository instead of in each one:

> This Source Code Form is subject to the terms of the Mozilla Public License,
> v. 2.0. If a copy of the MPL was not distributed with this file, You can
> obtain one at https://mozilla.org/MPL/2.0/.

An organisation may change the desktop and the consoles for itself. Whoever
distributes a changed version — and serving its browser code to users is
distributing it — publishes the files they changed; files they add are theirs.
A brand and extensions are configuration and new files, not changes.

The design system (`apps/*/frontend/design-system/`) is Apache-2.0, with its
own `LICENSE`, so that any app may carry the same look.

So is the **console kit**: the parts of the Admin Console another console is
built from — its styles and shell, the director client, sign-in, translation
loading, the export and backup-key screens, the backend's relay to the
director, and the chart's two Deployments. Each of those files says so on its
first line (`SPDX-License-Identifier: Apache-2.0`); the text is
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). A file without that line
is MPL-2.0.
