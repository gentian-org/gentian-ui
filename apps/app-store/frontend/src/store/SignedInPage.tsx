import { useTranslation } from "react-i18next";
import "./console.css";
import "./store.css";

/** Why a sign-in did not happen: a fixed set, as the API names them. */
const REASONS = new Set(["state", "other-session", "code", "exchange", "denied"]);

/**
 * Where the window that held the store's sign-in ends up.
 *
 * The API has exchanged the code by the time this is shown, and kept the
 * token. This page has nothing to do but say how it went: the page the
 * person came from is asking the API and carries on by itself. What is shown
 * for a failure is chosen from a fixed set by the one word the address
 * carries -- nothing a store or an issuer said is displayed here.
 */
export function SignedInPage() {
  const { t } = useTranslation();
  const error = new URLSearchParams(window.location.search).get("error");
  const reason = error === null ? null : REASONS.has(error) ? error : "other";
  return (
    <div className="admin-console admin-console--embedded">
      <div className="admin-console__frame">
        <div className="admin-console__body store-plain">
          <h1 className="admin-console__section-title">
            {reason === null ? t("signedIn.doneTitle") : t("signedIn.failedTitle")}
          </h1>
          <p className="admin-console__lead">{reason === null ? t("signedIn.doneBody") : t(`signInReason.${reason}`)}</p>
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn admin-console__btn--primary" onClick={() => window.close()}>
              {t("signedIn.close")}
            </button>
            <a className="admin-console__btn" href="/">
              {t("signedIn.continueHere")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
