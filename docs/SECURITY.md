# Security conventions — same as gentian-app-template/docs/SECURITY.md

See [gentian-app-template/docs/SECURITY.md](https://github.com/gentian-org/gentian-app-template/blob/main/docs/SECURITY.md).

The kernel shell follows the same app template controls. Differences:

- Deployed via `gentian-os` ApplicationSet, not AppProfile
- HTTPRoute attaches to `kernel-public-gateway` (not tenant Gateway)
- `rbac.create: true` for catalogue/app listing APIs
