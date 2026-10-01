# Gentian Shell — architecture (greenfield)

Kernel UI for Gentian OS: login hub, desktop/mobile bases, app launcher, iframe host.

## Routes

| Path | Surface |
|------|---------|
| `/login` | OIDC login hub |
| `/desktop` | Background + app menu + floating windows |
| `/mobile` | Background + bottom dock + fullscreen app |

## API (`shell-api`)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/session/me` | Current user |
| `GET /api/v1/apps/` | Installed apps + built-ins for launcher |
| `GET /api/v1/prefs/` | Shell preferences |

## Frontend layout

```
frontend/src/
  pages/          LoginPage, DesktopPage, MobilePage
  shell/          AppMenu, Background, MobileAppLayer, UserMenu
  windows/        WindowManager, iframe body, chrome icons, drag/resize hooks
  settings/       SettingsPanel
  stores/         Zustand — windows, apps
  api/            fetch client
  lib/            device detection
```

## Milestones

- **M1** — scaffold (this commit): routes, stub API, basic launcher + windows
- **M2** — Keycloak OIDC, K8s app list, WinBox.js wrapper
- **M3** — Postgres prefs, wallpaper upload, theme tokens

