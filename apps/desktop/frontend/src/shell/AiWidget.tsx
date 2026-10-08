import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  askAssistant,
  assistantAvailable,
  AssistantUnavailable,
  type AssistantMessage,
} from "@/api/assistant";

type AiWidgetProps = {
  isDesktop?: boolean;
  onExpand?: (prompt?: string) => void;
};

// The conversation the widget keeps is short: it is a quick question, and the
// server refuses a long one. The full app is one click away.
const MAX_TURNS = 20;

/**
 * The assistant on the desktop: a one-line prompt that unfolds into a short
 * conversation, answered through the desktop's own API.
 *
 * Whether there is an assistant is the server's to say. Where there is none
 * -- the cluster serves no models, or the platform has not given this desktop
 * a key -- the prompt is disabled and says so in one line; the button that
 * opens the full app keeps working, because that app is its own.
 */
export function AiWidget({ isDesktop = false, onExpand }: AiWidgetProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let current = true;
    void assistantAvailable().then((yes) => {
      if (current) setAvailable(yes);
    });
    return () => {
      current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

  const unavailable = available === false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy || unavailable) return;

    const history = [...messages, { role: "user" as const, content: text }].slice(-MAX_TURNS);
    setMessages([...history, { role: "assistant", content: "" }]);
    setPrompt("");
    setOpen(true);
    setBusy(true);
    setFailed(false);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await askAssistant(
        history,
        (piece) => {
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + piece };
            }
            return next;
          });
        },
        abort.signal,
      );
    } catch (error) {
      if (abort.signal.aborted) return;
      // The answer that never came is not part of the conversation.
      setMessages((prev) =>
        prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1].content
          ? prev.slice(0, -1)
          : prev,
      );
      if (error instanceof AssistantUnavailable) {
        setAvailable(false);
      } else {
        setFailed(true);
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setBusy(false);
    }
  }

  function expand() {
    if (!onExpand) return;
    const first = messages.find((m) => m.role === "user")?.content;
    onExpand(prompt.trim() || first || undefined);
    setPrompt("");
  }

  // Width of 6 standard tiles (44px each) + gaps
  const width = "284px";
  const note = unavailable ? t("ai.unavailable") : failed ? t("ai.failed") : "";

  return (
    <div
      className="ai-widget-container"
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: isDesktop ? "column" : "column-reverse",
      }}
    >
      <div
        className="ai-widget-input-area"
        title={unavailable ? t("ai.unavailable") : undefined}
        style={{
          width: "100%",
          height: "var(--app-menu-slot-size, 40px)",
          background: "var(--gtn-bg-secondary, rgba(255,255,255,0.1))",
          borderRadius: "var(--gtn-r1, 8px)",
          backdropFilter: "blur(10px)",
          border: "1px solid var(--gtn-border-primary, rgba(255,255,255,0.2))",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          opacity: unavailable ? 0.7 : 1,
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{ width: "100%", display: "flex", alignItems: "center", position: "relative" }}
        >
          <input
            type="text"
            placeholder={unavailable ? t("ai.unavailable") : t("ai.placeholder")}
            value={prompt}
            disabled={unavailable}
            aria-label={t("ai.placeholder")}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              color: "var(--gtn-text-primary, #334155)",
              outline: "none",
              fontSize: "14px",
              paddingRight: "28px",
              textOverflow: "ellipsis",
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              expand();
            }}
            style={{
              position: "absolute",
              right: "4px",
              background: "transparent",
              border: "none",
              color: "var(--gtn-text-secondary, #aaa)",
              cursor: "pointer",
              opacity: 0.5,
              fontSize: "16px",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={t("ai.expand")}
            aria-label={t("ai.expand")}
          >
            ⤢
          </button>
        </form>
      </div>

      {open && (messages.length > 0 || note) && (
        <div
          className="ai-widget-thread-area"
          style={{
            width: "100%",
            maxHeight: "300px",
            background: "var(--gtn-bg-primary, rgba(30,30,30,0.95))",
            borderRadius: "var(--gtn-r1, 8px)",
            backdropFilter: "blur(10px)",
            border: "1px solid var(--gtn-border-primary, rgba(255,255,255,0.2))",
            marginTop: isDesktop ? "8px" : 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
            // In the quick bar the thread floats above the bar; on the
            // desktop it unfolds below the prompt.
            position: isDesktop ? "relative" : "absolute",
            bottom: isDesktop ? "auto" : "48px",
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "4px 8px",
              borderBottom: "1px solid var(--gtn-border-primary, rgba(255,255,255,0.1))",
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--gtn-text-secondary, #aaa)",
                cursor: "pointer",
                fontSize: "12px",
              }}
              title={t("ai.collapse")}
              aria-label={t("ai.collapse")}
            >
              ✕
            </button>
          </div>
          <div
            ref={threadRef}
            aria-live="polite"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "13px",
              lineHeight: 1.4,
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "90%",
                  padding: "6px 10px",
                  borderRadius: "var(--gtn-r1, 8px)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  color: "var(--gtn-text-primary, #334155)",
                  background:
                    m.role === "user"
                      ? "var(--gtn-bg-secondary, rgba(255,255,255,0.12))"
                      : "transparent",
                }}
              >
                {m.content || (busy && i === messages.length - 1 ? t("ai.thinking") : "")}
              </div>
            ))}
            {note && (
              <div role="status" style={{ color: "var(--gtn-text-secondary, #aaa)", fontSize: "12px" }}>
                {note}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
