# concierge

The page on a cluster's bare domain, `https://<kernel>/`: the first thing
anybody typing the cluster's address meets. gentian-os installs it as a
component of the platform tenant from `chart/` and publishes it from that
tenant's DMZ, with no session in front of it. It asks for an e-mail address and sends the browser to the
console of the workspace the address belongs to:

| Address | Goes to |
|---|---|
| `<name>@<tenant>.<kernel>` | `https://console.<tenant>.<kernel>/` |
| `<name>@<kernel>` | `https://console.<kernel>/` |
| anything else | asks for the workspace's name |

The page asks the server nothing, so it cannot reveal whether an account
exists. It hands the address on as `?login_hint=` on the console's address:
the edge in front of the console starts the sign-in and passes the address it
was asked for to the identity provider inside the request's `state`, and the
login theme in gentian-os reads the hint from there and fills the username.
No cookie is set and nothing of this page's lives on the identity provider's
host.

## Configuration

`/sign-in/config.json`, mounted by the deployment. Every key is optional.

| Key | Meaning |
|---|---|
| `lookup` | A same-origin directory the page asks about addresses it cannot place: `GET <lookup><sha256-hex of the domain>.json` answering `{"url": "https://..."}`, or 404. gentian-os sets `/sign-in/lookup/` and the operator fills it with the tenants' custom domains; hashing the name means a domain is found only by someone who already knows it. |

On a cluster with one user tenant the operator puts `_single.json` in the
lookup directory, naming that tenant's console, and the page sends everybody
there without asking. The page forwards only to a console of this cluster,
written exactly as `https://console.<domain>/`:

- `https://console.<tenant>.<kernel>/`, one label under the kernel domain; or
- `https://console.<custom domain>/`, when the lookup directory also holds
  that domain's own file (`<sha256-hex of the domain>.json`) naming the same
  console, which is how the page knows the operator published the domain.

Anything else in the file, and the form is shown as on any other cluster. The
forward never leads to `https://console.<kernel>/`: that console is the
administrators', not a user tenant's, and while the forward is on they sign
in there by name, by opening `https://console.<kernel>/` themselves.

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
`.github/workflows/concierge.yaml` and run by gentian-os beside the identity
provider (`kernel/services/keycloak-idp`).
