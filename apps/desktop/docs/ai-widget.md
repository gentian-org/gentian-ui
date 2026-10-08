# AI Widget

The AI widget is the assistant on the desktop: a one-line prompt that unfolds
into a short conversation, answered by the platform's model gateway. It sits
where the Open WebUI tile is -- in the quick bar and on the desktop grid -- and
its expand button opens Open WebUI with the prompt, for a conversation that
should be kept.

## What it looks like

The widget is as wide as six tiles (284px).

- **Idle.** A single-line prompt, "Ask anything…".
- **Asked.** `Enter` sends the conversation. The thread unfolds -- above the
  quick bar, below the prompt on the desktop -- and the answer is written as it
  arrives. The thread scrolls and can be closed; the conversation stays until
  the page is left. It is kept in the browser's memory only, and is short: the
  last twenty messages are sent.
- **Expand.** The button at the right of the prompt opens Open WebUI with the
  prompt (or the conversation's first question).
- **Not available.** Where this desktop has no assistant the prompt is disabled
  and says so in one line. The expand button still opens the app. Nothing else
  on the desktop changes.

## How it reaches a model

```
browser ── POST /api/v1/llm/chat ──▶ desktop API ── /v1/chat/completions ──▶ model gateway
           (the conversation)         (this desktop's own key)
```

The browser talks to the desktop's own API and to nothing else. It never
learns where the gateway is or what the key is.

**The key is this tenant's desktop's.** In gentian-os the desktop's profile
declares the model gateway (`requires.services.llm`, optional). For each
tenant the operator generates a key for that tenant's desktop alone, registers
it at the gateway as `<tenant>-desktop`, writes it to the Secret
`llm-credentials-desktop` in the tenant's namespace, and opens the desktop's
pods a path to the gateway's port. It sets three chart values:

| Value | Meaning |
|-------|---------|
| `llm.available` | `true` once the key is registered and delivered |
| `llm.baseUrl` | the gateway's OpenAI-compatible address (ends in `/v1`) |
| `llm.apiKeySecretName` | the Secret holding the key (under `OPENAI_API_KEY`) |

The chart mounts that one key of the Secret as a file and tells the API
`LLM_AVAILABLE`, `LLM_BASE_URL` and `LLM_API_KEY_FILE`. The key is read from
the file on each request, so a key the platform replaces is picked up without
a restart. Outside a cluster, `LLM_API_KEY` supplies it instead.

The desktop holds no other credential for the gateway. It does not read the
gateway's administrator key and it does not call the Kubernetes API.

## The API (`backend/app/api/routes/llm.py`)

| Route | Answer |
|-------|--------|
| `GET /api/v1/llm/status` | `{"available": true \| false}`: whether this desktop has an assistant |
| `POST /api/v1/llm/chat` | the answer, streamed as server-sent events |

**Who may use it:** every signed-in member who can open the desktop. There is
no further restriction, and there never was one. The request must come from
the desktop's own origin (`app/core/origin_check.py`).

Because one key serves every member of the tenant, the API decides everything
about the call but the conversation:

- **Two upstream paths, both spelled in the code:** chat completions, and the
  model list (to pick a model that exists: the one asked for when the gateway
  serves it to this key, the first otherwise). Nothing in a request chooses a
  path or an address.
- **An allow-list builds the upstream body:** `messages` (roles `user` and
  `assistant`, text content), `model`, `stream`, `max_tokens`. Everything else
  a request carries is dropped; `n` is always 1.
- **Whose request it is:** the signed-in person's subject is sent as the
  OpenAI `user` field, which the gateway (LiteLLM) records as the end user of
  the request. A `user` in
  the request is ignored.
- **Caps:** the request body (`LLM_MAX_REQUEST_BYTES`, 64 KiB), the number of
  messages (`LLM_MAX_MESSAGES`, 40) and the tokens of an answer
  (`LLM_MAX_TOKENS`, 1024; a request may ask for fewer, never more).
- **Headers:** only the key and the content type go upstream. No cookie,
  token or forwarding header of the browser's does.
- **Errors:** the gateway's own error text is not relayed; its status is
  logged. The key is never logged.

| Status | When |
|--------|------|
| 503 | the platform says there is no gateway for this desktop, told it nothing, the key file is empty, the gateway cannot be reached, or it refuses the key |
| 502 | the gateway answered with an error of its own |
| 429 | the gateway says the key is over a limit |
| 413 | the request is larger or longer than the caps |
| 400 | the body is not a plain conversation |

## What this does not do

- **No limit per person.** A member can use the tenant's desktop key as often
  as the gateway lets that key be used. The gateway is told who asked, and
  nothing here counts or throttles by person.
- **No budget on the key.** The platform does not attach the desktop's key to
  the tenant's team at the gateway, so a tenant's spend is not capped by it.
- **The subject leaves the desktop.** It is the identity provider's opaque
  id, not a name or an address; a gateway configured with a model provider
  outside the cluster may pass it on to that provider.
- **The widget appears only where Open WebUI is installed,** because it takes
  that tile's place. The assistant's API does not depend on Open WebUI.
