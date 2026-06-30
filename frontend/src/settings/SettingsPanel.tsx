import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteBackground, fetchBackgroundBlob, fetchPrefs, uploadBackground } from "@/api/prefs";
import { DEFAULT_SHELL_BACKGROUND } from "@/lib/background";
import { useInvalidateShellBackground } from "@/shell/useShellBackground";
import "@/styles/shell-panel.css";

type SettingsPanelProps = {
  embedded?: boolean;
};

export function SettingsPanel({ embedded = false }: SettingsPanelProps) {
  const queryClient = useQueryClient();
  const invalidateBackground = useInvalidateShellBackground(queryClient);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [savedPreviewUrl, setSavedPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prefsQuery = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
  });

  const savedBackgroundQuery = useQuery({
    queryKey: ["prefs", "background-blob"],
    queryFn: fetchBackgroundBlob,
    enabled: Boolean(prefsQuery.data?.hasBackground),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!savedBackgroundQuery.data) {
      setSavedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(savedBackgroundQuery.data);
    setSavedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [savedBackgroundQuery.data]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadBackground(file),
    onSuccess: async () => {
      setError(null);
      setMessage("Desktop background updated.");
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        setLocalPreviewUrl(null);
      }
      await invalidateBackground();
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: deleteBackground,
    onSuccess: async () => {
      setError(null);
      setMessage("Restored default desktop background.");
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        setLocalPreviewUrl(null);
      }
      await invalidateBackground();
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const previewUrl = localPreviewUrl ?? savedPreviewUrl ?? DEFAULT_SHELL_BACKGROUND;
  const rootClass = `shell-panel${embedded ? " shell-panel--embedded" : ""}`;

  return (
    <div className={rootClass}>
      <div className="shell-panel__frame">
        <header className="shell-panel__header">
          <div className="shell-panel__eyebrow">Desktop shell</div>
          <h1 className="shell-panel__title">Settings</h1>
        </header>

        <div className="shell-panel__body">
          <section>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Appearance</h2>
            <p className="shell-panel__hint" style={{ marginBottom: "1rem" }}>
              Choose a wallpaper for your desktop. JPEG, PNG, WebP, or GIF up to 5 MB.
            </p>

            {message && <p className="shell-panel__success">{message}</p>}
            {error && <p className="shell-panel__error">{error}</p>}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                setMessage(null);
                setError(null);
                if (localPreviewUrl) {
                  URL.revokeObjectURL(localPreviewUrl);
                }
                setLocalPreviewUrl(URL.createObjectURL(file));
                uploadMutation.mutate(file);
                event.target.value = "";
              }}
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <button
                type="button"
                className="shell-panel__btn shell-panel__btn--primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "Uploading…" : "Upload image"}
              </button>
              <button
                type="button"
                className="shell-panel__btn"
                disabled={resetMutation.isPending || !prefsQuery.data?.hasBackground}
                onClick={() => {
                  setMessage(null);
                  resetMutation.mutate();
                }}
              >
                Use default
              </button>
            </div>

            <div
              className="shell-panel__preview"
              style={{ backgroundImage: `url('${previewUrl}')` }}
              aria-label="Background preview"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
