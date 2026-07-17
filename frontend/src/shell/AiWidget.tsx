import { useState } from "react";

type AiWidgetProps = {
  isDesktop?: boolean;
  onExpand?: (prompt?: string) => void;
};

export function AiWidget({ isDesktop = false, onExpand }: AiWidgetProps) {
  const [prompt, setPrompt] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (onExpand) {
      onExpand(prompt.trim() || undefined);
    }
    setPrompt("");
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
        flexDirection: isDesktop ? "column" : "column-reverse",
      }}
    >
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
                onExpand(prompt.trim() || undefined);
                setPrompt("");
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
    </div>
  );
}
