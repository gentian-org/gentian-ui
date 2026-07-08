import { useState } from "react";
import tileCatalogue from "../../public/tiles/catalogue.json";
import { tileIconUrl } from "@/lib/tiles";

type CustomizeTileModalProps = {
  initialTitle: string;
  initialIcon: string;
  isLink?: boolean;
  initialUrl?: string;
  initialOpenMode?: "iframe" | "tab";
  onSave: (data: { title: string; icon: string; url?: string; openMode?: "iframe" | "tab" }) => void;
  onClose: () => void;
  onDelete?: () => void;
};

export function CustomizeTileModal({
  initialTitle,
  initialIcon,
  isLink = false,
  initialUrl = "",
  initialOpenMode = "iframe",
  onSave,
  onClose,
  onDelete,
}: CustomizeTileModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState(initialIcon);
  const [url, setUrl] = useState(initialUrl);
  const [openMode, setOpenMode] = useState<"iframe" | "tab">(initialOpenMode);
  const [customIconError, setCustomIconError] = useState<string | null>(null);

  const availableIcons = Object.keys(tileCatalogue.tiles);

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 200 * 1024) {
      setCustomIconError("Image must be smaller than 200 KB");
      return;
    }

    setCustomIconError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setIcon(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleFormSave(e: React.FormEvent) {
    e.preventDefault();
    if (isLink && !url) {
      alert("Please enter a URL.");
      return;
    }
    onSave({
      title: title.trim() || initialTitle,
      icon,
      ...(isLink ? { url: url.trim(), openMode } : {}),
    });
  }

  return (
    <div
      className="customize-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="customize-modal-panel">
        <header className="customize-modal-header">
          <h2 className="customize-modal-title">
            {isLink ? (initialTitle ? "Edit Link Shortcut" : "Add Link Shortcut") : "Customize App Tile"}
          </h2>
          <button type="button" className="customize-modal-close" onClick={onClose}>
            &times;
          </button>
        </header>

        <form onSubmit={handleFormSave} className="customize-modal-form">
          <div className="customize-modal-field">
            <label className="customize-modal-label">Title / Label</label>
            <input
              type="text"
              className="customize-modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. My Website"
              required
            />
          </div>

          {isLink && (
            <>
              <div className="customize-modal-field">
                <label className="customize-modal-label">URL</label>
                <input
                  type="url"
                  className="customize-modal-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </div>

              <div className="customize-modal-field">
                <label className="customize-modal-label">Open target in</label>
                <select
                  className="customize-modal-select"
                  value={openMode}
                  onChange={(e) => setOpenMode(e.target.value as "iframe" | "tab")}
                >
                  <option value="iframe">Floating Window (embedded iframe)</option>
                  <option value="tab">New Browser Tab</option>
                </select>
              </div>
            </>
          )}

          <div className="customize-modal-field">
            <label className="customize-modal-label">Tile Symbol / Icon</label>
            <div className="customize-modal-icon-preview-container">
              <img
                src={icon.startsWith("data:") ? icon : tileIconUrl(icon)}
                alt="Selected icon preview"
                className="customize-modal-icon-preview"
              />
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  id="custom-tile-icon-upload"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <label htmlFor="custom-tile-icon-upload" className="customize-modal-upload-btn">
                  Upload custom image…
                </label>
                <span className="customize-modal-hint">PNG, JPEG or SVG under 200 KB</span>
                {customIconError && <p className="customize-modal-error">{customIconError}</p>}
              </div>
            </div>

            <label className="customize-modal-label" style={{ marginTop: "1rem" }}>
              Or choose a built-in symbol:
            </label>
            <div className="customize-modal-icons-grid">
              {availableIcons.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  className={`customize-modal-grid-icon-btn${icon === iconName ? " customize-modal-grid-icon-btn--selected" : ""}`}
                  onClick={() => setIcon(iconName)}
                  title={iconName}
                >
                  <img src={tileIconUrl(iconName)} alt={iconName} />
                </button>
              ))}
            </div>
          </div>

          <footer className="customize-modal-footer">
            {onDelete && (
              <button type="button" className="customize-modal-delete-btn" onClick={onDelete}>
                Delete Shortcut
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="customize-modal-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="customize-modal-btn customize-modal-btn--primary">
                Save
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
