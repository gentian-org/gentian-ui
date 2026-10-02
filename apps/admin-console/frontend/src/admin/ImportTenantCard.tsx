import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchImportStatus, importTenant, uploadBundle } from "@/api/cluster";
import "./admin.css";

/**
 * A tenant from a bundle: the way back for an export (sovereignty-concept.md
 * §4.3). The file is uploaded, the director opens its manifest with the key
 * typed here, declares the tenant from it and restores once the operator
 * has provisioned the shells. The card follows the import until people can
 * sign in again.
 */
export function ImportTenantCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [tenant, setTenant] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("import.chooseFile"));
      const bundle = await uploadBundle(file);
      const secret = key.trim();
      const decryption = secret.startsWith("AGE-SECRET-KEY-") ? { identity: secret } : { passphrase: secret };
      return importTenant(bundle, decryption, name.trim() || undefined);
    },
    onSuccess: (status) => {
      setTenant(status.tenant);
      setKey("");
      void queryClient.invalidateQueries({ queryKey: ["cluster", "tenants"] });
    },
  });

  const status = useQuery({
    queryKey: ["cluster", "import", tenant],
    queryFn: () => fetchImportStatus(tenant as string),
    enabled: tenant !== null,
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      return phase === "ready" || phase === "failed" ? false : 10000;
    },
  });

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("import.title")}</h3>
      <p className="admin-console__lead">{t("import.lead")}</p>
      <form
        className="admin-console__form admin-console__form--plain"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <div className="admin-console__field">
          <label className="admin-console__label" htmlFor="import-file">
            <span className="admin-console__label-text">{t("import.file")}</span>
            <input id="import-file" type="file" accept=".gentian,application/x-tar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="admin-console__field">
          <label className="admin-console__label" htmlFor="import-key">
            <span className="admin-console__label-text">{t("import.key")}</span>
            <input id="import-key" type="password" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
          </label>
          <p className="admin-console__hint">{t("import.keyHint")}</p>
        </div>
        <div className="admin-console__field">
          <label className="admin-console__label" htmlFor="import-name">
            <span className="admin-console__label-text">{t("import.name")}</span>
            <input id="import-name" type="text" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="admin-console__hint">{t("import.nameHint")}</p>
        </div>
        {start.isError && <p className="admin-console__error">{(start.error as Error).message}</p>}
        <div className="admin-console__form-footer">
          <button className="admin-console__btn admin-console__btn--primary" type="submit" disabled={!file || !key.trim() || start.isPending}>
            {start.isPending ? t("import.uploading") : t("import.start")}
          </button>
        </div>
      </form>

      {tenant && status.data && (
        <p className={status.data.phase === "failed" ? "admin-console__error" : "admin-console__success"}>
          <Trans
            i18nKey={`import.phase_${status.data.phase}`}
            values={{ tenant, message: status.data.message ?? "" }}
            components={{ mono: <span className="admin-console__mono" /> }}
          />
          {status.data.phase === "ready" && status.data.passwordResetRequired ? " " + t("import.passwordReset") : ""}
        </p>
      )}
    </div>
  );
}
