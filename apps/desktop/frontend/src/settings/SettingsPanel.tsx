import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteBackground, fetchBackgroundBlob, fetchPrefs, uploadBackground } from "@/api/prefs";
import { DEFAULT_SHELL_BACKGROUND } from "@/lib/background";
import { useInvalidateShellBackground } from "@/shell/useShellBackground";
import "@/styles/shell-panel.css";

import { useTranslation } from "react-i18next";
import { applyStoredLanguage, languages } from "@/lib/i18n";
import { usePrefsStore } from "@/stores/prefs";
type SettingsPanelProps = {
  embedded?: boolean;
};

export function SettingsPanel({ embedded = false }: SettingsPanelProps) {
  const { t } = useTranslation();
  const customPrefs = usePrefsStore((state) => state.customPrefs);
  const tenantLanguage = usePrefsStore((state) => state.tenantLanguage);
  const updateCustomPrefs = usePrefsStore((state) => state.updateCustomPrefs);
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
      setMessage(t("settings.backgroundUpdated"));
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
      setMessage(t("settings.backgroundRestored"));
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
          <div className="shell-panel__eyebrow">{t("settings.shell")}</div>
          <h1 className="shell-panel__title">{t("settings.title")}</h1>
        </header>

        <div className="shell-panel__body">
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>{t("settings.language")}</h2>
            <p className="shell-panel__hint" style={{ marginBottom: "1rem" }}>
              {t("settings.languageHint")}
            </p>
            <select
              className="shell-panel__input"
              aria-label={t("settings.language")}
              // "" is "match my browser". Read from the account rather than
              // from i18n's resolved language, because those differ: a German
              // browser with no stored choice resolves to de while the chooser
              // must still show "match my browser", or a person cannot tell
              // their own choice from a detection.
              value={customPrefs.language ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                // The account first, so the choice follows this person to
                // another machine; then this page, so it takes effect now.
                //
                // Clearing a choice falls back to the tenant's language, not
                // to the browser: the browser is the last resort, for a tenant
                // that declared none. Someone who un-chooses should get what
                // their colleagues get, which is what the option says.
                void updateCustomPrefs((prev) => ({ ...prev, language: next || undefined }));
                applyStoredLanguage(next || tenantLanguage || undefined);
              }}
            >
              <option value="">
                {tenantLanguage
                  ? t("settings.languageTenant", {
                      language: t(`language.${tenantLanguage}`, { defaultValue: tenantLanguage }),
                    })
                  : t("settings.languageSystem")}
              </option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {t(`language.${code}`, { defaultValue: code })}
                </option>
              ))}
            </select>
          </section>

          <section>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>{t("settings.appearance")}</h2>
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
                {uploadMutation.isPending ? t("settings.backgroundUploading") : t("settings.backgroundUpload")}
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
              aria-label={t("settings.backgroundPreview")}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
