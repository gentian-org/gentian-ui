import { useState, useRef, useEffect } from "react";

type Message = { role: "user" | "assistant"; content: string };

type AiWidgetProps = {
  isDesktop?: boolean;
  onExpand?: () => void;
};

export function AiWidget({ isDesktop = false, onExpand }: AiWidgetProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, expanded]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    const userMsg: Message = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setExpanded(true);
    setLoading(true);

    // Simulate LLM response delay bridging to Open WebUI / LiteLLM proxy
    setTimeout(() => {
      const assistantMsg: Message = {
        role: "assistant",
        content: "This is a simulated response. In production, this integrates via the Gentian OIDC session with the tenant's Open WebUI instance at ai-chat.[tenantDomain].",
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setLoading(false);
    }, 1500);
  }

  // Width of 6 standard tiles (44px each) + gaps
  const width = "284px";

  return (
    <div
      className="ai-widget-container"
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: isDesktop ? "column" : "column-reverse", // Expand direction based on context
      }}
    >
      {/* Input Area (Collapsed State is just this) */}
      <div
        className="ai-widget-input-area"
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
        }}
      >
        <form onSubmit={handleSubmit} style={{ width: "100%", display: "flex", alignItems: "center" }}>
          <span style={{ marginRight: "8px", color: "var(--gtn-text-secondary, #aaa)" }}>✨</span>
          <input
            type="text"
            placeholder="Ask anything..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--gtn-text-primary, #fff)",
              outline: "none",
              fontSize: "14px",
            }}
          />
        </form>
      </div>

      {/* Unfolded Thread Area */}
      {expanded && (
        <div
          className="ai-widget-thread-area"
          style={{
            width: "100%",
            height: "300px",
            background: "var(--gtn-bg-primary, rgba(30,30,30,0.95))",
            borderRadius: "var(--gtn-r1, 8px)",
            backdropFilter: "blur(10px)",
            border: "1px solid var(--gtn-border-primary, rgba(255,255,255,0.2))",
            marginTop: isDesktop ? "8px" : 0,
            marginBottom: isDesktop ? 0 : "8px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
            // If in the quick bar (not desktop), we typically want it floating above the bar absolutely.
            // For a robust implementation, this would be `position: "absolute", bottom: "48px"` etc.
            position: isDesktop ? "relative" : "absolute",
            bottom: isDesktop ? "auto" : "48px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid var(--gtn-border-primary, rgba(255,255,255,0.1))",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--gtn-text-secondary, #aaa)", fontWeight: 500 }}>
              AI Chat
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--gtn-text-secondary, #aaa)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
                title="Collapse"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={onExpand}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--gtn-text-secondary, #aaa)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
                title="Expand to Full App"
              >
                ⤢
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={threadRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  background: msg.role === "user" ? "var(--gtn-primary, #007bff)" : "rgba(255,255,255,0.1)",
                  color: "#fff",
                  padding: "8px 12px",
                  borderRadius: "12px",
                  maxWidth: "85%",
                  fontSize: "13px",
                  lineHeight: 1.4,
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  color: "var(--gtn-text-secondary, #aaa)",
                  fontSize: "12px",
                  fontStyle: "italic",
                }}
              >
                Thinking...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
