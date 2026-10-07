# Security — the App Store app

The conventions every platform UI in this repository follows are in
[apps/admin-console/docs/SECURITY.md](../../admin-console/docs/SECURITY.md)
(M1–M27). This app follows them, with no CORS at all (M9: the bundle and the
API share one origin). What is below is what this app adds, because it is the
one component that renders content from, and signs a person in to, a service
outside the cluster.

| Control | Where | What it guarantees |
|---|---|---|
| Caller verification and relay | `backend/app/core/auth.py`, `backend/app/core/director.py` | The edge's forwarded token is verified (issuer, signature, expiry, audience) and relayed unchanged to the director, the custodian and the usher. The app decides nothing about who may do what |
| Origin check | `backend/app/core/origin_check.py` | POST, PUT, PATCH and DELETE are taken only from this app's own origin |
| No CORS | `backend/app/main.py` | No other origin can read an answer of this API |
| Anonymous browsing | `backend/app/store/client.py` | Open reads carry no token, cookie, `Referer`, `Origin`, tenant or cluster identifier; the `User-Agent` names the app and its version only. A token is never sent on an open read |
| Outbound destinations | `backend/app/store/client.py` | Requests go to the configured store's origin, and to the issuer and media origins its meta names — https only, public hosts only, no redirect followed, with a timeout and a size limit |
| Store content is data | `backend/app/store/models.py`, `frontend/src/lib/storeMarkdown.js`, `frontend/src/store/StoreMarkdown.tsx` | Answers are checked against the definition and unknown members dropped. Text is rendered as text; Markdown through an allow-list of node types; links only to absolute `https`, in a separate window, `rel="noopener noreferrer"`. No `dangerouslySetInnerHTML` anywhere |
| Images | `backend/app/store/media.py` | Fetched by the backend only from `mediaOrigins`, only PNG, JPEG or WebP by header and by content, size-limited, served from this origin; loaded with `referrerpolicy="no-referrer"` |
| Content security policy | `frontend/docker-entrypoint.sh`, `frontend/public/serve.json` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'`, plus the cluster's own domain for the brand. No inline script. `Referrer-Policy: no-referrer`. `frame-ancestors` is the platform's Gateway policy, as for the Admin Console |
| API answers | `backend/app/core/security_headers.py` | `Cache-Control: no-store`, `default-src 'none'`, `nosniff`, `no-referrer` on every answer |
| Store sign-in | `backend/app/store/oauth.py` | Authorization code with PKCE (S256), public client, no secret. `state` and the verifier stay in the backend, are used once and are bound to the cluster session (`sub` + `sid`) that started the sign-in; a callback on another session is refused. `redirect_uri` is exactly `https://<host>/oauth/callback` |
| Store token | `backend/app/store/oauth.py` | Kept in the API's memory, keyed by the cluster session, until it expires or the person signs out of the store. Never in an answer, a cookie, a log or a file. Refresh tokens are not used |
| Repository credential | `backend/app/install/sequence.py` | Held in memory between the store's confirmation and the custodian's answer, never returned to the browser, never logged |
| Dangerous changes | `backend/app/install/sequence.py` | A `428` from the director is shown to the person with the director's text; `confirm` is sent only with what they typed |
| Checkout | `backend/app/install/sequence.py` | A checkout address is handed to the browser only when it is on one of the store's `checkoutOrigins`, and is opened in a separate window |
| Identifiers | `backend/app/store/patterns.py` | Every coordinate half, acquisition id and name is checked against the definition's pattern before it is put into an upstream path |
| Logs | `backend/Dockerfile`, `backend/app/main.py` | The server's access log is off (the sign-in callback's query is a code) and the HTTP client's request log is silenced; the app logs method and path |

## What it does not guarantee

* **One process.** The state above is in one process's memory. The chart
  runs one replica of the API and the schema refuses more.
* **The end of a cluster session is not signalled.** A store token outlives a
  sign-out from the cluster until its own expiry; it is unreachable from any
  other session, since another sign-in is another `sid`. A zone token with no
  `sid` binds to the person alone.
* **Public-host checks are a lookup, not a pin.** The check that an issuer or
  media origin is a public host does not close the window to the
  connection's own lookup; the tenant namespace's egress policy stands
  behind it.
