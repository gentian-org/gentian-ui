import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { decideAccess, fetchAccess, fetchMeta, type TenantAccount } from "@/api/store";
import { ProblemNote } from "@/store/parts";
import { useStoreSession } from "@/store/session";

/**
 * Who manages this tenant at the store.
 *
 * The first account that signed in for the tenant holds it. Another account
 * asks to manage it by acquiring an app, and its acquisition waits until the
 * holder approves -- here -- or the store's operator does. The store
 * decides; this only shows what it says and hands the holder's word on. Only
 * where the store has `tenant-access`, and only for the holder.
 */
export function AccessButton() {
  const { t } = useTranslation();
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const kept = metaQuery.data?.features.includes("tenant-access") === true;
  const query = useQuery({
    queryKey: ["store", "access", signedIn],
    queryFn: fetchAccess,
    enabled: signedIn && kept,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  if (!signedIn || !kept || query.data?.role !== "holder") return null;
  const asking = query.data.accounts.filter((a) => a.role === "requested").length;
  return (
    <>
      <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setOpen(true)}>
        {t("access.headerAction")}
        {asking ? <span className="admin-console__badge admin-console__badge--warn">{asking}</span> : null}
      </button>
      {open ? <AccessDialog accounts={query.data.accounts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AccessDialog({ accounts, onClose }: { accounts: TenantAccount[]; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ subject, approve }: { subject: string; approve: boolean }) => decideAccess(subject, approve),
    onSettled: () => client.invalidateQueries({ queryKey: ["store", "access"] }),
  });
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="access-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="admin-console__dialog-body">
        <h3 id="access-title" className="admin-console__dialog-title">
          {t("access.title")}
        </h3>
        <p className="admin-console__lead">{t("access.lead")}</p>
        {accounts.length === 0 ? <p className="admin-console__meta">{t("access.nobody")}</p> : null}
        <ul className="store-access">
          {accounts.map((a) => (
            <li key={a.subject} className="store-access__row">
              <span>
                <strong>{a.name || a.email || a.subject}</strong>
                {a.email && a.name ? <span className="admin-console__meta"> · {a.email}</span> : null}
              </span>
              <span className="admin-console__meta">{t(`access.role_${a.role}`)}</span>
              <span className="admin-console__actions">
                {a.role !== "manager" ? (
                  <button
                    type="button"
                    className="admin-console__btn admin-console__btn--primary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ subject: a.subject, approve: true })}
                  >
                    {t("access.approve")}
                  </button>
                ) : null}
                {a.role !== "declined" ? (
                  <button
                    type="button"
                    className="admin-console__btn"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ subject: a.subject, approve: false })}
                  >
                    {a.role === "manager" ? t("access.end") : t("access.decline")}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {decide.error ? <ProblemNote error={decide.error} /> : null}
        <div className="admin-console__actions">
          <button type="button" className="admin-console__btn" onClick={onClose}>
            {t("access.close")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
