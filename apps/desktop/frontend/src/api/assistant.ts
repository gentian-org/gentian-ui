import { getAccessToken, isEdgeSession, redirectToLoginForExpiredSession } from "@/auth/oidc";

import { apiFetch } from "./client";

/**
 * The assistant on the desktop, as the desktop's own API offers it.
 *
 * The browser talks to this API and to nothing else: where the model gateway
 * is and the key this desktop presents to it stay on the server. What is sent
 * is the conversation; the server decides the model, the length of an answer
 * and whose request it is.
 */

export type AssistantMessage = { role: "user" | "assistant"; content: string };

/** The server answered that this desktop has no assistant (503). */
export class AssistantUnavailable extends Error {
  constructor() {
    super("assistant unavailable");
    this.name = "AssistantUnavailable";
  }
}

/** Whether this desktop has an assistant at all. False when it cannot be asked. */
export async function assistantAvailable(): Promise<boolean> {
  try {
    const status = await apiFetch<{ available?: boolean }>("/llm/status");
    return status?.available === true;
  } catch {
    return false;
  }
}

/**
 * Sends the conversation and calls onText with each piece of the answer as it
 * arrives. Throws AssistantUnavailable on 503, Error on anything else.
 */
export async function askAssistant(
  messages: AssistantMessage[],
  onText: (piece: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch("/api/v1/llm/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (response.status === 503) {
    throw new AssistantUnavailable();
  }
  if (response.status === 401 && (token || isEdgeSession())) {
    redirectToLoginForExpiredSession();
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream") || !response.body) {
    // Behind the edge an ended session answers with the sign-in page.
    if (response.ok && isEdgeSession() && type.includes("text/html")) {
      redirectToLoginForExpiredSession();
    }
    throw new Error(`assistant: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  // An event may arrive split across two reads; what is left of the last
  // line waits here for the rest of it.
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as {
            choices?: { delta?: { content?: unknown } }[];
          };
          const piece = event.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece) onText(piece);
        } catch {
          // Not an event this widget reads.
        }
      }
    }
    if (done) return;
  }
}
