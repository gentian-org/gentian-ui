import { useEffect, useState } from "react";
import tileCatalog from "../../public/tiles/catalogue.json";
import { PERSON_TILE_TYPES, personTileFileError, tileIconUrl } from "@/lib/tiles";
import { TileImage } from "@/shell/TileImage";

import { useTranslation } from "react-i18next";
type CustomizeTileModalProps = {
  initialTitle: string;
  initialIcon: string;
  isLink?: boolean;
  initialUrl?: string;
  initialOpenMode?: "iframe" | "tab";
  /**
   * `iconFile` is a picture the person picked and has not been kept yet: the
   * caller uploads it under the tile's id and draws the tile from the address
   * the API answers. Without it, `icon` is a glyph or the picture as it was.
   */
  onSave: (data: {
    title: string;
    icon: string;
    iconFile?: File;
    url?: string;
    openMode?: "iframe" | "tab";
  }) => void;
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
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState(initialIcon);
  const [url, setUrl] = useState(initialUrl);
  const [openMode, setOpenMode] = useState<"iframe" | "tab">(initialOpenMode);
  const [customIconError, setCustomIconError] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // The picked file's preview, drawn from its own bytes and let go of when
  // another is picked or the dialog closes.
  useEffect(() => {
    if (!iconFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);

  const availableIcons = Object.keys(tileCatalog.tiles);

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // A PNG, JPEG or WebP of at most 1 MiB; never an SVG. The API checks the
    // bytes again, so this only spares the person a refused upload.
    const problem = personTileFileError(file);
    if (problem) {
      setCustomIconError(problem === "size" ? t("tile.iconTooLarge") : t("tile.iconWrongType"));
      event.target.value = "";
      return;
    }

    setCustomIconError(null);
    setIconFile(file);
  }

  function handleFormSave(e: React.FormEvent) {
    e.preventDefault();
    let finalUrl = url.trim();
    if (isLink) {
      if (!finalUrl) {
        alert(t("tile.urlRequired"));
        return;
      }
      // Auto-prefix protocol if missing
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(finalUrl)) {
        if (finalUrl.startsWith("//")) {
          finalUrl = `https:${finalUrl}`;
        } else {
          finalUrl = `https://${finalUrl}`;
        }
      }
    }
    onSave({
      title: title.trim() || initialTitle,
      icon,
      ...(iconFile ? { iconFile } : {}),
      ...(isLink ? { url: finalUrl, openMode } : {}),
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
            {isLink ? (initialTitle ? t("tile.editLink") : t("tile.addLink")) : t("tile.customize")}
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
              placeholder={t("tile.namePlaceholder")}
              required
            />
          </div>

          {isLink && (
            <>
              <div className="customize-modal-field">
                <label className="customize-modal-label">URL</label>
                <input
                  type="text"
                  className="customize-modal-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (trimmed && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
                      if (trimmed.startsWith("//")) {
                        setUrl(`https:${trimmed}`);
                      } else {
                        setUrl(`https://${trimmed}`);
                      }
                    }
                  }}
                  placeholder="https://example.com"
                  required
                />
              </div>

              <div className="customize-modal-field">
                <label className="customize-modal-label">{t("tile.openTargetIn")}</label>
                <select
                  className="customize-modal-select"
                  value={openMode}
                  onChange={(e) => setOpenMode(e.target.value as "iframe" | "tab")}
                >
                  <option value="iframe">Floating Window (embedded iframe)</option>
                  <option value="tab">{t("tile.newBrowserTab")}</option>
                </select>
              </div>
            </>
          )}

          <div className="customize-modal-field">
            <label className="customize-modal-label">Tile Symbol / Icon</label>
            <div className="customize-modal-icon-preview-container">
              {preview ? (
                <img src={preview} alt={t("tile.iconPreview")} className="customize-modal-icon-preview" />
              ) : (
                <TileImage icon={icon} alt={t("tile.iconPreview")} className="customize-modal-icon-preview" />
              )}
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept={PERSON_TILE_TYPES.join(",")}
                  id="custom-tile-icon-upload"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <label htmlFor="custom-tile-icon-upload" className="customize-modal-upload-btn">
                  Upload custom image…
                </label>
                <span className="customize-modal-hint">{t("tile.iconHint")}</span>
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
                  className={`customize-modal-grid-icon-btn${!iconFile && icon === iconName ? " customize-modal-grid-icon-btn--selected" : ""}`}
                  onClick={() => {
                    setIconFile(null);
                    setIcon(iconName);
                  }}
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
