# Gentian administration console

The console an MSP employee or an IT administrator uses to configure a tenant
and, for a platform administrator, the cluster underneath. It is a component
of the platform, built from
[gentian-app-template](https://github.com/gentian-org/gentian-app-template),
and a client of the gentian-os director: every screen reads through the
director and writes through it, and what a person may see or change is the
director's answer from the authorization graph. The console itself holds no
credential, keeps no state, and decides nothing.

## Layout

```
backend/    FastAPI. Verifies the token the platform's edge forwards, relays it to the
            director, hands the answer back unchanged. backend/app/api/routes/admin.py
            also lists every screen not yet re-pointed at the director.
frontend/   React. The screens under src/admin/, the design tokens they use under
            design-system/, and a root that mounts the console as the whole page.
chart/      Helm. Two Deployments and two Services, named from fullnameOverride so the
            profile can route to them.
```

## How it is deployed

By the gentian-os operator, from the `ComponentProfile` named `admin-console` that
the operator chart ships (`charts/gentian-os/templates/componentprofile-admin-console.yaml`).
The profile declares `defaultForTenants: true`, so every tenant gets one, at
`admin.<zone domain>`, behind the zone's session, and the desktop shows it as a
tile to whoever holds `can_administer` on the tenant. The profile maps the facts
of the cluster into this chart's values; nothing about the cluster is configured
here.

There is no profile in this repository on purpose. The profile is the
platform's statement about the component, and it lives with the platform.

## Where the screens stand

The console was carved out of the desktop, where its screens reached Keycloak
and Kubernetes through the desktop's backend with credentials this component
must not hold. Screens are re-pointed at the director one at a time. Until a
screen's director endpoints exist, its routes answer 501 naming the screen, and
the console shows that. `NOT_YET_MAPPED` in `backend/app/api/routes/admin.py` is
the list.

Working today: Tenants, Cluster settings, and People, which is a link into
Keycloak's own console. Everything else is on the list.

## Models

The Models tab is the cluster administrator's: the models the cluster's model
gateway offers, which are the Cluster claim's (`spec.llm`). It reads and writes
them through the director (`GET` / `PUT /v1/clusters/{c}/models`), which decides
who may, holds a change to the claim's schema and commits it; the console
reaches neither the gateway nor git. A model that is not on the screen when it
is committed is removed from the gateway.

Each model shows whether it can work, without asking the gateway: a model the
cluster would serve itself is flagged as not served, because the director says
the platform starts no server for it; a provider's model is checked against the
credentials list (the custodian's) and flagged when its token is missing or
there is no credential to enter it under. A token that is there is reported as
supplied, not as working. No token is entered on this tab.

The cluster declares the credential `llm-provider-<name>` for every provider on
the claim, so a new provider's token can be entered on the Credentials tab once
the cluster has applied the commit. A provider reads its own token only: the
property is `<name>_api_key`, shown and not editable. The director refuses a
provider address that is not a public https address. The tab also carries the
switch for the gateway's own console, with a warning that it opens a public
address.

## Apps

The Apps tab is where a tenant's apps are administered; the desktop only shows
tiles and opens them. It lists the installed apps from two answers — what git
declares (the director) and what the cluster has made of it (the usher) — and
says so where they disagree. For one app it shows its state, who has access
and whether it is for everyone, what it exchanges with other apps, what it
asked of the platform and what was approved, and it uninstalls. Purging the
data of an app that is no longer installed is a separate, typed-out act.
For an app that declares entries for the internet, its Details also list them
under "Public addresses and requests": the kind of entry, the address, the
paths, whether anybody signs in, and whether the entry was approved. The
same list carries an entry behind sign-in that asks to keep the app's own
`Authorization` header, which is approved the same way and publishes
nothing. What a kind means, who can reach an entry and the limit that
applies are the director's sentences, shown as they came. A person the director says may publish
for the tenant (`can_expose`) is offered Approve, Review and Withdraw there;
the same is done with `kubectl gentian exposures`. An approval shows the
kind, the address, the paths and who can reach it, and is confirmed by typing
the entry's name; the kind shown is sent with it, so the director refuses the
approval if the entry has come to declare another. An entry for the cluster's main address also shows the
director's rule and needs its own tick. The backend relays the approval and
the withdrawal to the director with the person's token, for this console's
tenant only, and passes a refusal on as it came. An entry with no address is
not offered for approval, and one of a component the platform itself ships is
left to the command.

Nothing is installed from the console. Apps come from the App Store, or from
`kubectl gentian apps install` where no store is available: the cluster renders
no catalogue of its own. The Catalogues screen and its routes are kept and not
shown (`SHOW_CATALOGUES` in `frontend/src/admin/AdminConsole.tsx`).

## Local development

```bash
docker compose -f docker-compose.dev.yaml up --build
```

Runs the API with authentication off and the frontend under Vite. Without a
director reachable, every screen that asks it reports that the director is not
configured, which is the truthful state.
