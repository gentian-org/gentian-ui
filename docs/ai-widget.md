# AI Widget

The AI Widget is a special UI element within the Gentian OS shell designed to provide immediate access to LLM interactions. It acts as a bridge to the Open WebUI application without requiring the user to switch context fully.

## UI / UX Design

### Concept
The widget behaves as an oversized "tile" that occupies the space of 6 standard tiles (roughly 280px to 300px wide, depending on layout scaling).
It can be placed in two primary locations:
1. **Quick Bar (App Menu):** Resides among other app tiles at the bottom or top of the screen.
2. **Desktop:** Acts as a floating widget on the desktop grid.

### Interactions
- **Idle State:** Displays a single-line text input field ("Ask anything...").
- **Active State:** When the user types a prompt and presses `Enter`, the prompt is dispatched to the LLM backend. 
- **Thread Unfolding:** As the response arrives, the widget unfolds vertically (either upwards if in the bottom Quick Bar, or downwards if space permits on the desktop). This expanded area displays the conversation thread.
- **Scrolling:** The unfolded thread area is scrollable to accommodate long responses and follow-up prompts.
- **Expand to Full App:** A subtle "expand" icon button sits in the top-right corner of the unfolded widget. Clicking it opens the full Open WebUI application, seamlessly continuing the current conversation.

## Architectural Integration with Open WebUI

The AI widget relies on the existing `open-webui` AppProfile deployed in the Gentian OS cluster.

### 1. API Communication
Open WebUI provides a backend API (e.g., `/api/chat/completions`) which proxies requests to the centralized LiteLLM proxy in the `platform-kernel` namespace. 
The widget will send HTTP requests to `https://ai-chat.${TENANT_DOMAIN}/api/...` from the frontend.

### 2. Authentication & Session Sharing
The `open-webui` application is configured to use the Gentian Keycloak OIDC provider.
- Because Gentian OS uses standard OIDC, the user's active session in the shell can seamlessly authenticate with the Open WebUI backend if configured to share the OIDC session cookies, or by passing the JWT token directly.
- The widget will leverage the shell's active `idpSession` or an API token minted for the user to securely interact with the Open WebUI backend on their behalf.

### 3. State Management
- **Local State:** The widget maintains its unfolded state and current prompt locally in React state (`useState`).
- **Thread State:** The conversation history for the *current* thread is maintained in the widget. When the user clicks "expand", the widget passes the current Chat ID or Thread ID to Open WebUI (e.g., via a deep link like `https://ai-chat.${TENANT_DOMAIN}/c/<chat_id>`).

## Future Considerations
- Drag-and-drop mechanics in the Quick Bar need to account for multi-column spans (`colspan=6`).
- Desktop grid snapping logic should be adjusted so the 6-tile-wide widget does not overlap other tiles.
