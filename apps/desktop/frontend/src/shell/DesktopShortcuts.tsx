import { useState, useEffect, useRef } from "react";
import { usePrefsStore, type DesktopTile } from "@/stores/prefs";
import { TileImage } from "@/shell/TileImage";
import { deletePersonTile, uploadPersonTile } from "@/api/prefs";
import { isApiTile } from "@/lib/tiles";
import { CustomizeTileModal } from "@/shell/CustomizeTileModal";
import { AiWidget } from "@/shell/AiWidget";
import type { ShellApp } from "@/api/client";

import { useTranslation } from "react-i18next";
const GRID_X = 100;
const GRID_Y = 110;

function snapToGrid(x: number, y: number) {
  // Pad slightly from the edges
  const minX = 20;
  const minY = 20;
  const snappedX = Math.max(minX, Math.round((x - minX) / GRID_X) * GRID_X + minX);
  const snappedY = Math.max(minY, Math.round((y - minY) / GRID_Y) * GRID_Y + minY);
  return { x: snappedX, y: snappedY };
}

type DesktopShortcutsProps = {
  apps: ShellApp[];
  onSelectApp: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onOpenLinkWindow: (tile: DesktopTile) => void;
};

export function DesktopShortcuts({ apps, onSelectApp, onOpenLinkWindow }: DesktopShortcutsProps) {
  const { t } = useTranslation();
  const rawTiles = usePrefsStore((s) => s.customPrefs.desktopTiles);
  const rawCustomizations = usePrefsStore((s) => s.customPrefs.tileCustomizations);
  const updateCustomPrefs = usePrefsStore((s) => s.updateCustomPrefs);

  const tiles = rawTiles || [];
  const customizations = rawCustomizations || {};
  const [editingTile, setEditingTile] = useState<DesktopTile | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tile?: DesktopTile } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Close context menu on click
  useEffect(() => {
    function handleGlobalClick() {
      setContextMenu(null);
    }
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);

  function handleTileDragStart(e: React.DragEvent, tile: DesktopTile) {
    const payload = JSON.stringify({ type: "existing", id: tile.id });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function handleTileClick(e: React.MouseEvent, tile: DesktopTile) {
    const forceNewWindow = e.ctrlKey || e.metaKey;
    if (tile.type === "app" && tile.appId) {
      const app = apps.find((a) => a.id === tile.appId);
      if (app) {
        onSelectApp(app, { forceNewWindow });
      }
    } else if (tile.type === "link" && tile.url) {
      if (forceNewWindow || tile.openMode === "tab") {
        window.open(tile.url, "_blank");
      } else {
        onOpenLinkWindow(tile);
      }
    }
  }

  function handleTileEdit(tile: DesktopTile) {
    setEditingTile(tile);
    setContextMenu(null);
  }

  /**
   * The icon a tile is saved with. A picture the person picked is kept by the
   * API under the tile's id first, and the tile is drawn from the address it
   * answers; one they replaced with a glyph is let go of there. Null when the
   * upload was refused, and nothing is saved.
   */
  async function savedIcon(
    tileId: string,
    previous: string | undefined,
    data: { icon: string; iconFile?: File },
  ): Promise<string | null> {
    if (data.iconFile) {
      try {
        return await uploadPersonTile(tileId, data.iconFile);
      } catch (err) {
        console.error("Failed to save the tile picture:", err);
        alert(t("tile.iconUploadFailed"));
        return null;
      }
    }
    if (previous && isApiTile(previous) && data.icon !== previous) {
      deletePersonTile(tileId).catch((err) => console.error("Failed to remove the tile picture:", err));
    }
    return data.icon;
  }

  async function handleSaveCustomization(data: {
    title: string;
    icon: string;
    iconFile?: File;
    url?: string;
    openMode?: "iframe" | "tab";
  }) {
    if (isCreatingLink) {
      // Add new link shortcut
      const containerRect = containerRef.current?.getBoundingClientRect();
      const clickX = contextMenu ? contextMenu.x - (containerRect?.left || 0) : 50;
      const clickY = contextMenu ? contextMenu.y - (containerRect?.top || 0) : 50;
      const snapped = snapToGrid(clickX - 46, clickY - 49); // offset to center tile relative to click

      const id = crypto.randomUUID();
      const icon = await savedIcon(id, undefined, data);
      if (icon === null) return;
      const newTile: DesktopTile = {
        id,
        type: "link",
        title: data.title,
        icon,
        url: data.url,
        openMode: data.openMode,
        position: snapped,
      };

      updateCustomPrefs((prev) => ({
        ...prev,
        desktopTiles: [...(prev.desktopTiles || []), newTile],
      }));
      setIsCreatingLink(false);
    } else if (editingTile) {
      if (editingTile.type === "link") {
        // Update link shortcut
        const icon = await savedIcon(editingTile.id, editingTile.icon, data);
        if (icon === null) return;
        updateCustomPrefs((prev) => ({
          ...prev,
          desktopTiles: (prev.desktopTiles || []).map((t) =>
            t.id === editingTile.id
              ? { ...t, title: data.title, icon, url: data.url, openMode: data.openMode }
              : t,
          ),
        }));
      } else if (editingTile.type === "app" && editingTile.appId) {
        // Customize app tile title and icon override (applies universally)
        const appId = editingTile.appId;
        const icon = await savedIcon(appId, customizations[appId]?.icon, data);
        if (icon === null) return;
        updateCustomPrefs((prev) => {
          const tc = prev.tileCustomizations || {};
          return {
            ...prev,
            tileCustomizations: {
              ...tc,
              [appId]: {
                title: data.title,
                icon,
              },
            },
          };
        });
      }
      setEditingTile(null);
    }
  }

  function handleDeleteShortcut(tileId: string) {
    if (confirm(t("tile.deleteConfirm"))) {
      const removed = tiles.find((tile) => tile.id === tileId);
      if (removed?.type === "link" && isApiTile(removed.icon)) {
        deletePersonTile(tileId).catch((err) => console.error("Failed to remove the tile picture:", err));
      }
      updateCustomPrefs((prev) => ({
        ...prev,
        desktopTiles: (prev.desktopTiles || []).filter((t) => t.id !== tileId),
      }));
      setEditingTile(null);
      setContextMenu(null);
    }
  }

  function handleDesktopContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const tileEl = target.closest(".desktop-tile-wrapper");

    if (tileEl) {
      const tileId = tileEl.getAttribute("data-id");
      const tile = tiles.find((t) => t.id === tileId);
      if (tile) {
        setContextMenu({ x: e.clientX, y: e.clientY, tile });
        return;
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      ref={containerRef}
      className="desktop-shortcuts-container"
      onContextMenu={handleDesktopContextMenu}
    >
      {tiles.map((tile) => {
        let displayTitle = tile.title;
        let displayIcon = tile.icon;
        // The AI widget stands for the app opened at mount for it
        // (gentianos.io/portal-preopen); the shell does not know which app it is.
        const isAiWidget =
          tile.type === "app" && Boolean(apps.find((a) => a.id === tile.appId)?.preopen);

        if (tile.type === "app" && tile.appId) {
          const app = apps.find((a) => a.id === tile.appId);
          if (!app) return null; // skip if app not installed/found
          const custom = customizations[tile.appId];
          displayTitle = custom?.title || app.title;
          displayIcon = custom?.icon || app.icon;
        }

        return (
          <div
            key={tile.id}
            data-id={tile.id}
            className={isAiWidget ? "desktop-tile-wrapper desktop-tile-wrapper--ai" : "desktop-tile-wrapper"}
            style={{
              left: tile.position.x,
              top: tile.position.y,
            }}
            draggable
            onDragStart={(e) => handleTileDragStart(e, tile)}
            onClick={(e) => handleTileClick(e, tile)}
          >
            {isAiWidget ? (
              <div onClick={(e) => e.stopPropagation()}>
                <AiWidget
                  isDesktop={true}
                  onExpand={(prompt) => {
                    const app = apps.find((a) => a.id === tile.appId);
                    if (app) {
                      const dynamicApp = { ...app };
                      if (prompt && dynamicApp.launchUrl) {
                        const separator = dynamicApp.launchUrl.includes("?") ? "&" : "?";
                        dynamicApp.launchUrl += `${separator}q=${encodeURIComponent(prompt)}`;
                      }
                      onSelectApp(dynamicApp);
                    }
                  }}
                />
              </div>
            ) : (
              <div className="desktop-tile" title={tile.type === "link" ? tile.url : displayTitle}>
                <TileImage className="desktop-tile__icon" icon={displayIcon} />
                <span className="desktop-tile__label">{displayTitle}</span>
              </div>
            )}
           </div>
         );
       })}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="desktop-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.tile ? (
            <>
              <button type="button" onClick={() => handleTileEdit(contextMenu.tile!)}>
                Edit Shortcut
              </button>
              <button
                type="button"
                className="desktop-context-menu__delete"
                onClick={() => handleDeleteShortcut(contextMenu.tile!.id)}
              >
                Delete Shortcut
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsCreatingLink(true);
                setContextMenu({ ...contextMenu });
              }}
            >
              Add Link Shortcut
            </button>
          )}
        </div>
      )}

      {/* Customization Modal */}
      {editingTile && (
        <CustomizeTileModal
          initialTitle={
            editingTile.type === "app" && editingTile.appId
              ? customizations[editingTile.appId]?.title || apps.find((a) => a.id === editingTile.appId)?.title || editingTile.title
              : editingTile.title
          }
          initialIcon={
            editingTile.type === "app" && editingTile.appId
              ? customizations[editingTile.appId]?.icon || apps.find((a) => a.id === editingTile.appId)?.icon || editingTile.icon
              : editingTile.icon
          }
          isLink={editingTile.type === "link"}
          initialUrl={editingTile.url}
          initialOpenMode={editingTile.openMode}
          onSave={handleSaveCustomization}
          onClose={() => setEditingTile(null)}
          onDelete={editingTile.type === "link" ? () => handleDeleteShortcut(editingTile.id) : undefined}
        />
      )}

      {isCreatingLink && (
        <CustomizeTileModal
          initialTitle=""
          initialIcon="link"
          isLink={true}
          onSave={handleSaveCustomization}
          onClose={() => setIsCreatingLink(false)}
        />
      )}
    </div>
  );
}
