# sign-in

The page at `https://id.<kernel>/sign-in/`, which the kernel domain's apex
sends people to. It asks for an e-mail address and sends the browser to the
console of the workspace the address belongs to:

| Address | Goes to |
|---|---|
| `<name>@<tenant>.<kernel>` | `https://console.<tenant>.<kernel>/` |
| `<name>@<kernel>` | `https://console.<kernel>/` |
| anything else | asks for the workspace's name |

The page asks the server nothing, so it cannot reveal whether an account
exists. It hands the address to the workspace's sign-in form through a
short-lived cookie that only the identity provider's realm pages receive
(`gentian_login_hint`, host-only on `id.<kernel>`, path `/auth/realms/`); the
login theme in gentian-os fills the username from it.

## Configuration

`/sign-in/config.json`, mounted by the deployment. Every key is optional.

| Key | Meaning |
|---|---|
| `lookup` | A same-origin directory the page asks about addresses it cannot place: `GET <lookup><sha256-hex of the domain>.json` answering `{"url": "https://..."}`, or 404. gentian-os sets `/sign-in/lookup/` and the operator fills it with the tenants' custom domains; hashing the name means a domain is found only by someone who already knows it. |

## The cluster's brand

The same server serves `/branding/` (`brand.css`, `brand.json`,
`brand.webmanifest`, icons), which the operator renders from the cluster's
Branding and every page on the cluster loads: this one, the identity
provider's, the desktop and the consoles. `brand.json` is served with
`Access-Control-Allow-Origin: *` because the consoles read it from their own
hosts; it holds nothing that is not on every page anyway.

## Development

Static files, no build: `site/sign-in/` is what is served. `symlinks` is on in
`serve.json` because a mounted ConfigMap is a directory of symlinks. `npm test` runs the
routing tests with Node's own test runner. The image is built by
`.github/workflows/sign-in.yaml` and run by gentian-os beside the identity
provider (`kernel/services/keycloak-idp`).
