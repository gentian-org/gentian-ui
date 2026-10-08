import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchAppStates } from "@/api/admin";
import { useBrand } from "@/lib/brand";
import "./admin.css";

/**
 * The Operations Console, promoted or linked.
 *
 * Export is this console's; scheduled backups, external destinations,
 * recovery on a click and drills are the Operations Console's, an Aluvian
 * app installed from the store and free under fifty users. When it is
 * installed this card is the way there; when it is not, it says what it would
 * give this tenant. The free path above it always works on its own.
 *
 * A provider running the cluster under its own brand may take the vendor's
 * offer off (hideVendorPromotions): then the card is a link once the console
 * is there and nothing before.
 */
export function OperationsPromo() {
  const { t } = useTranslation();
  const brand = useBrand();
  const states = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: () => fetchAppStates() });
  const operations = states.data?.apps.find((a) => a.profile === "operations-console");
  // Both consoles are tiles of the same tenant on the same domain: swap the
  // first label of this host for the Operations Console's.
  const host = window.location.hostname.replace(/^[^.]+\./, "operations.");
  if (brand.hideVendorPromotions && !operations) return null;

  return (
    <section className="admin-console__card admin-console__card--promo">
      <div className="admin-console__card-main">
        <h3 className="admin-console__card-title">{t("export.opsTitle")}</h3>
        <p className="admin-console__card-desc">{t("export.opsLead")}</p>
        <ul className="admin-console__list">
          <li>{t("export.opsScheduled")}</li>
          <li>{t("export.opsRemote")}</li>
          <li>{t("export.opsRecovery")}</li>
        </ul>
        {operations?.ready ? (
          <a className="admin-console__btn admin-console__btn--primary" href={`https://${host}/`}>
            {t("export.opsOpen")}
          </a>
        ) : operations ? (
          <p className="admin-console__hint">{t("export.opsInstalling", { phase: operations.phase })}</p>
        ) : (
          <p className="admin-console__hint">{t("export.opsInstall")}</p>
        )}
      </div>
    </section>
  );
}
