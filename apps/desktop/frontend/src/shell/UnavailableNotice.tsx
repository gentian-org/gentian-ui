import { useTranslation } from "react-i18next";

type UnavailableNoticeProps = {
  notice: { title: string; text: string } | null;
  onClose: () => void;
};

/**
 * Says why a tile that is shown cannot be opened.
 *
 * A tile that is merely missing reads as "you may not have this"; one the
 * cluster withholds for a reason of its own is kept and answers with that
 * reason when it is selected.
 */
export function UnavailableNotice({ notice, onClose }: UnavailableNoticeProps) {
  const { t } = useTranslation();
  if (!notice) return null;
  return (
    <div className="customize-modal-overlay" role="presentation">
      <div
        className="customize-modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unavailable-notice-title"
        aria-describedby="unavailable-notice-text"
      >
        <header className="customize-modal-header">
          <h2 className="customize-modal-title" id="unavailable-notice-title">
            {notice.title}
          </h2>
        </header>
        <div className="customize-modal-form">
          <p id="unavailable-notice-text">{notice.text}</p>
          <div className="customize-modal-footer">
            <button
              type="button"
              className="customize-modal-btn customize-modal-btn--primary"
              onClick={onClose}
              autoFocus
            >
              {t("store.unavailable.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
