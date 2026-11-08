# Frontend stack

**React + Vite + TypeScript + Tailwind** for the Gentian kernel shell and all
first-party Gentian UI.

Primary driver: coding agents produce more reliable code on React/TSX than Vue SFCs.
See [gentian-apps/apps/_template/docs/FRONTEND-STACK.md](https://github.com/gentian-org/gentian-apps/blob/develop/apps/_template/docs/FRONTEND-STACK.md) for the full greenfield rationale.

## Canonical libraries

- **Routing:** TanStack Router
- **Server state:** TanStack Query
- **Client state:** Zustand
- **Windows (M2):** WinBox.js thin wrapper in `frontend/src/windows/`
