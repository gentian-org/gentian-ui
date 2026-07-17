import { useState, useRef, useEffect } from "react";
import { getAccessToken } from "@/auth/oidc";

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

    try {
      const token = getAccessToken();
      const response = await fetch("/api/v1/llm/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo", // Fallback model, typically LiteLLM handles routing
          messages: [...messages, userMsg],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      let assistantContent = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      setLoading(false);

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                    assistantContent += data.choices[0].delta.content;
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      newMessages[newMessages.length - 1].content = assistantContent;
                      return newMessages;
                    });
                  }
                } catch (e) {
                  console.error("Error parsing SSE data:", e);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, an error occurred." }]);
      setLoading(false);
    }
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
        <form onSubmit={handleSubmit} style={{ width: "100%", display: "flex", alignItems: "center", position: "relative" }}>
          <input
            type="text"
            placeholder="Ask anything..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--gtn-text-primary, #334155)",
              outline: "none",
              fontSize: "14px",
              paddingRight: "28px",
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (onExpand) {
                onExpand();
              }
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
            title="Expand to Full App"
          >
            ⤢
          </button>
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
                onClick={() => {
                  if (onExpand) {
                    onExpand();
                  }
                }}
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
