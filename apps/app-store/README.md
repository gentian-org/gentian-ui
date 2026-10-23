# Gentian App Store app

The store's interface, on the cluster. A store is a service outside the
cluster that holds the data about apps — what they are, their versions and
build digests, prices, and what a tenant has acquired. This app fetches that
data, renders it, and does the installing on the cluster's side, as the person
signed in. It is installed per tenant, at `store.<the tenant's base domain>`,
for people who may install apps there.

It has two sides and holds them apart. Toward the store it is a client of the
store API: anonymous for browsing, and with the token of the person's store
account for what concerns the tenant. Toward the cluster it is a caller like
any other: it asks the director, the custodian and the usher with the token
the platform's edge forwards. It has no authority of its own in either
direction, no credential, no database and no Kubernetes access.

## Layout

```
backend/    FastAPI. Reads the store's catalogue and serves it to the bundle; runs the
            sign-in to the store and keeps its token; drives acquire → declare the
            repository → set its credential → install, one step per request.
frontend/   React. The catalogue, and an app's details on top of it. The design tokens and
            the console kit's styles are the Admin Console's.
chart/      Helm. Two Deployments and two Services, named from fullnameOverride so the
            profile can route to them.
```

## What it does

* **Browsing needs no store account.** The backend reads the store's open
  reads anonymously — no token, no tenant, no cluster, a `User-Agent` naming
  only this app — caches them for as long as the store says, and honours its
  rate limits. The browser never talks to a store.
* **Store content is data.** Text is shown as text. Descriptions and release
  notes are the restricted Markdown subset `store-markdown-1`, read into a
  tree of allow-listed nodes (`frontend/src/lib/storeMarkdown.js`) and never
  into HTML. Pictures are fetched by the backend — only from the origins the
  store's meta lists, only PNG, JPEG or WebP — and served from this origin,
  so the pages' content security policy is `img-src 'self'`.
* **Sign-in to the store** only when the person acquires something, opens
  what the tenant has acquired, or writes a review: authorization code with
  PKCE, as a public
  client. The backend builds the request, receives the redirect on
  `/oauth/callback`, exchanges the code and keeps the token in memory, bound
  to the person's cluster session (`backend/app/store/oauth.py`). The browser
  learns that the person is signed in, and nothing else. Nothing is pressed
  for it: the whole window goes to the store's issuer and comes back to the
  page it left (`returnTo`, a path of this app), which goes on with what was
  asked -- an install with the choice already made. Shown in a frame, the
  sign-in opens in a window of its own instead.
* **Who gets an app** is the one question before an install: everybody by
  default (every member of the tenant), or only selected users, who are then
  given it in the Admin Console -- the install's last step links to the
  app's Access there (`?tab=apps&app=<app>`).
* **Acquire and install** (`backend/app/install/sequence.py`): acquire at the
  store, wait for a checkout where one is needed, declare the repository at
  the director under the name computed from the tenant and the address
  (`backend/app/store/naming.py`), set its credential at the custodian,
  install with `{coordinate, digest, defaultGrant}`, pin the add-ons, and
  show the usher's progress. Every step is asked with the person's own token
  and is safe to repeat; a page loaded in the middle shows where things
  stand, derived from the store, the director and the usher.
* **Add-ons**: each is a store entry of its own, ticked in its app's
  details and taken by Install, with the app or beside it once it is there.
  Its sequence is the app's up to the install, which it skips: its build is pinned in the app's add-ons
  (`PUT .../apps/{app}/addons`), and it waits on the app's rollout and
  approvals. Removing it sends the list without it.
* **Reviews and the company** (`backend/app/api/routes/account.py`): a
  signed-in person writes, changes and withdraws their own review of an
  entry, and says which company they are with -- its size and industry are
  shown with their reviews and filter them, its name never is. Offered only
  by a store whose meta lists `review-writing` and `company`. The sign-in
  asks for exactly the scopes the store's meta lists; a 1.2 store lists
  none, and decides from its own records what the account may do.
* **Who manages the tenant** (`backend/app/api/routes/account.py`, store
  API 1.2, `tenant-access`): the first account to sign in for the tenant at
  the store holds it. Another account's acquisition waits for that holder's
  approval, which the holder gives from the header ("Who manages this
  tenant"); only an account that manages the tenant is handed its
  repository credentials.
* **Support** (`backend/app/api/routes/account.py`, store API 1.3,
  `support`): the partners that offer support for an app, as the store lists
  them, in the app's details. A partner's contact address opens in a separate
  window; a signed-in person may send a request for an offer the store takes
  requests for, with an optional message, and the store says it received it.
  The form says what is passed on: the person's name, e-mail address,
  company and message, to the partner. The offers are asked for the tenant's
  country (`TENANT_COUNTRY`) by default; a switch on the page asks for
  another, or for none ("All countries"), and holds for the browser session.
  With no country the store lists what it has.
* **What the tenant has, per app** (`backend/app/api/routes/install.py`):
  each tile of the catalogue says Install, Buy, Continue or Installed, from
  what the tenant has acquired joined with what is installed (`/overview`).
  An app's details show its acquisition and the installation's state;
  update when the store's newest build is not the one pinned; replace a
  repository credential, behind a confirmation.
* **The scorecard** (store API 1.6): the edition, the store's maturity
  score (0 to 10, as the store defines it), the customization grade and
  highest rung the profile declares, the reviews' average and the
  installation count. What the store does not say is said to be missing.

Nothing is uninstalled or purged here. An installed app is administered in
the Admin Console's Apps tab.

## How it is deployed

By the gentian-os operator, from a `ComponentProfile` named `app-store` that
gentian-os ships. There is no profile in this repository on purpose: the
profile is the platform's statement about the component. The profile maps the
facts of the cluster into this chart's values (`chart/values.yaml`):

| Value | What it is |
|---|---|
| `host` | This app's own host, `store.<the tenant's base domain>`. The store sign-in is spelled from it |
| `store.url` | The store API's base address. Empty: the app says no App Store is configured |
| `director.url`, `director.cluster` | The director, and the cluster's id |
| `custodian.url`, `usher.url` | The custodian and the usher |
| `platform.tenant`, `platform.kernelDomain`, `platform.realm`, `platform.zoneKind` | Facts of the cluster |
| `api.env.DESKTOP_API_URL` | The tenant's desktop API, where a tile the tenant chose is stored |
| `api.env.TENANT_COUNTRY` | The tenant's country (Tenant `spec.country`), ISO 3166-1 alpha-2; empty when it names none |
| `auth.mode`, `auth.issuer`, `auth.clientId`, `auth.audience` | How the forwarded token is verified |

The edge has to route `/api`, `/oauth/callback`, `/healthz` and `/readyz` to
the API with the zone's token forwarded, and `/` to the web container.

**One replica of the API.** Pending sign-ins, store tokens and in-flight
repository credentials live in its memory; `chart/values.yaml` says what a
second replica would need.

## The store API's definition

The app is built to the store API's OpenAPI definition, kept in gentian-os. A
copy is vendored for the tests (`backend/tests/contract/`), which run against
a fake store that is itself validated against it.

## Local development

```bash
docker compose -f docker-compose.dev.yaml up --build
```

Runs the API with authentication off and the frontend under Vite. Without a
store named (`STORE_URL`), the app says that no App Store is configured, which
is the truthful state.

```bash
cd backend && pip install -e ".[dev]" && ruff check app tests && python -m pytest -q
cd frontend && npm ci && npm test && npm run build
```
