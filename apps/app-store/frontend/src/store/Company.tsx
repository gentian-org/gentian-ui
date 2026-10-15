import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchCompany, fetchMeta, putCompany, type Company, type CompanySize, type StoreMeta } from "@/api/store";
import { ProblemNote } from "@/store/parts";
import { useStoreSession } from "@/store/session";

/**
 * The company the person's account at the store is with.
 *
 * The store shows a review with its author's company size and industry --
 * never the company's name -- and lets readers filter by them; it refuses a
 * review until the account has said. Asked once after a sign-in that finds
 * none, and editable from the header. Only where the store keeps one
 * (`company` in its features): a 1.0 store is never asked.
 */

const LATER_KEY = "app-store.company-later";

function laterWasChosen(): boolean {
  try {
    return window.sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
}

function chooseLater(): void {
  try {
    window.sessionStorage.setItem(LATER_KEY, "1");
  } catch {
    // Without storage it is hidden until the page is loaded again.
  }
}

/** Whether this store keeps a company, and the person is signed in to ask it. */
export function useCompany(meta: StoreMeta | undefined) {
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const kept = meta?.features.includes("company") === true;
  const query = useQuery({
    queryKey: ["store", "company", signedIn],
    queryFn: fetchCompany,
    enabled: signedIn && kept,
    retry: false,
  });
  return { available: signedIn && kept, query };
}

export function CompanyForm({
  meta,
  initial,
  onSaved,
  onCancel,
  cancelLabel,
}: {
  meta: StoreMeta;
  initial: Company | null;
  onSaved: (company: Company) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [size, setSize] = useState<string>(initial?.size ?? "");
  const [industry, setIndustry] = useState<string>(initial?.industry ?? "");
  const save = useMutation({
    mutationFn: putCompany,
    onSuccess: (answer) => {
      queryClient.setQueriesData({ queryKey: ["store", "company"] }, answer);
      onSaved(answer.company);
    },
  });
  const complete = name.trim() !== "" && size !== "" && industry !== "";
  return (
    <form
      className="store-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) save.mutate({ name: name.trim(), size: size as CompanySize, industry });
      }}
    >
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("company.name")}</span>
        <input type="text" value={name} maxLength={120} autoComplete="organization" onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("company.size")}</span>
        <select className="store-input" value={size} onChange={(event) => setSize(event.target.value)}>
          <option value="">{t("company.choose")}</option>
          {meta.companySizes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("company.industry")}</span>
        <select className="store-input" value={industry} onChange={(event) => setIndustry(event.target.value)}>
          <option value="">{t("company.choose")}</option>
          {meta.industries.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="admin-console__hint">{t("company.shownAs")}</p>
      {save.error ? <ProblemNote error={save.error} /> : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={!complete || save.isPending}>
          {t("company.save")}
        </button>
        {onCancel ? (
          <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onCancel}>
            {cancelLabel ?? t("company.cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Asked once, after a sign-in that finds the account has no company. "Later" hides it for this session. */
export function CompanyPrompt() {
  const { t } = useTranslation();
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const { available, query } = useCompany(metaQuery.data);
  const [later, setLater] = useState(laterWasChosen);
  const [saved, setSaved] = useState(false);
  if (!available || !metaQuery.data || later || saved || !query.isSuccess || query.data.company !== null) return null;
  return (
    <div className="store-signin store-company" role="region" aria-labelledby="company-prompt-title">
      <h2 id="company-prompt-title" className="admin-console__subsection-title">
        {t("company.promptTitle", { store: metaQuery.data.name })}
      </h2>
      <p className="admin-console__lead">{t("company.promptLead")}</p>
      <CompanyForm
        meta={metaQuery.data}
        initial={null}
        onSaved={() => setSaved(true)}
        onCancel={() => {
          chooseLater();
          setLater(true);
        }}
        cancelLabel={t("company.later")}
      />
    </div>
  );
}

/** The header's way to the company: shown while signed in to a store that keeps one. */
export function CompanyButton() {
  const { t } = useTranslation();
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const { available, query } = useCompany(metaQuery.data);
  const [open, setOpen] = useState(false);
  if (!available || !metaQuery.data) return null;
  return (
    <>
      <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setOpen(true)}>
        {t("company.headerAction")}
      </button>
      {open ? (
        <CompanyDialog meta={metaQuery.data} initial={query.data?.company ?? null} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function CompanyDialog({ meta, initial, onClose }: { meta: StoreMeta; initial: Company | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="company-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="admin-console__dialog-body">
        <h3 id="company-title" className="admin-console__dialog-title">
          {t("company.dialogTitle", { store: meta.name })}
        </h3>
        <p className="admin-console__lead">{t("company.promptLead")}</p>
        <CompanyForm meta={meta} initial={initial} onSaved={onClose} onCancel={onClose} />
      </div>
    </dialog>
  );
}
