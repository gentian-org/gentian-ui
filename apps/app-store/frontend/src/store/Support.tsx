import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemOf } from "@/api/client";
import { requestSupport, type AppDetail, type StoreMeta, type SupportOffer, type SupportReceipt } from "@/api/store";
import i18n from "@/lib/i18n";
import { ExternalLink, Picture, ProblemNote, StoreSignIn } from "@/store/parts";
import { useStoreSession } from "@/store/session";

/**
 * The partners that offer support for an app, as the store lists them, and a
 * way to ask one of them.
 *
 * Shown only by a store that has them (`support` in its features). Everything
 * here is the store's word, shown as text: who the partner is and whether the
 * store verified them, where and in which languages they help, what they
 * offer and what it costs as they put it. What it costs, and on which terms,
 * is between the person, the partner and the store; this app shows it and
 * sends a request on. A partner's own pages open in a separate window.
 */

/** A country's or a language's name in the reader's language; the code when there is none. */
function displayName(type: "region" | "language", code: string): string {
  try {
    return new Intl.DisplayNames([i18n.resolvedLanguage ?? "en"], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

function RequestForm({ offer, coordinate, storeName }: { offer: SupportOffer; coordinate: string; storeName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [received, setReceived] = useState<SupportReceipt | null>(null);

  const send = useMutation({
    mutationFn: () => requestSupport(coordinate, { offer: offer.id, message: message.trim() || null }),
    onSuccess: (answer) => {
      setReceived(answer.request);
      setOpen(false);
      setMessage("");
    },
    onError: (error) => {
      if (problemOf(error).code === "store-sign-in-required") {
        void queryClient.invalidateQueries({ queryKey: ["store", "session"] });
      }
    },
  });

  if (received) {
    return (
      <p className="admin-console__success store-support__received" role="status">
        {t("support.received", { store: storeName, partner: offer.partner.name, reference: received.id })}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn" onClick={() => setOpen(true)}>
          {t("support.request")}
        </button>
      </div>
    );
  }
  if (!signedIn) {
    return <StoreSignIn reason={t("support.signInToRequest", { store: storeName })} storeName={storeName} />;
  }
  return (
    <form
      className="store-form store-review-form"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("support.messageField")}</span>
        <textarea
          className="store-input store-textarea"
          value={message}
          maxLength={2000}
          rows={4}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <p className="admin-console__hint">{t("support.sentTo", { store: storeName, partner: offer.partner.name })}</p>
      {send.error ? <ProblemNote error={send.error} /> : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={send.isPending}>
          {t("support.send")}
        </button>
        <button
          type="button"
          className="admin-console__btn admin-console__btn--quiet"
          onClick={() => {
            setOpen(false);
            send.reset();
          }}
        >
          {t("support.cancel")}
        </button>
      </div>
    </form>
  );
}

function OfferCard({ offer, coordinate, storeName }: { offer: SupportOffer; coordinate: string; storeName: string }) {
  const { t } = useTranslation();
  const { partner } = offer;
  const countries = offer.countries.map((code) => displayName("region", code)).join(", ");
  const languages = offer.languages.map((code) => displayName("language", code)).join(", ");
  return (
    <li className="admin-console__card store-support__offer">
      <Picture src={partner.logoUrl} alt="" className="store-support__logo" initialOf={partner.name} />
      <div className="admin-console__card-main">
        <p className="admin-console__card-title">
          <ExternalLink href={partner.url}>{partner.name}</ExternalLink>
          {partner.verified ? <span className="admin-console__badge admin-console__badge--ok">{t("support.verified")}</span> : null}
        </p>
        <p className="admin-console__card-meta">
          {countries ? t("support.countries", { countries }) : t("support.worldwide")}
          {languages ? ` · ${t("support.languages", { languages })}` : ""}
        </p>
        {offer.tiers.length > 0 ? (
          <ul className="store-support__tiers">
            {offer.tiers.map((tier, index) => (
              <li key={index}>
                <span className="store-support__tier-name">{tier.name}</span>
                {tier.description ? <span className="admin-console__card-desc"> {tier.description}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {offer.priceHint ? <p className="admin-console__card-desc">{offer.priceHint}</p> : null}
        {offer.contactUrl && offer.contactUrl.startsWith("https://") ? (
          <div className="admin-console__actions">
            <a className="admin-console__btn" href={offer.contactUrl} target="_blank" rel="noopener noreferrer">
              {t("support.contact")}
            </a>
          </div>
        ) : null}
        {offer.requestable ? <RequestForm offer={offer} coordinate={coordinate} storeName={storeName} /> : null}
      </div>
    </li>
  );
}

export function Support({ detail, meta, storeName }: { detail: AppDetail; meta: StoreMeta | undefined; storeName: string }) {
  const { t } = useTranslation();
  const offers = detail.support ?? [];
  if (meta?.features.includes("support") !== true || offers.length === 0) return null;
  return (
    <section className="admin-console__subsection store-support">
      <h2 className="admin-console__subsection-title">{t("support.title")}</h2>
      <p className="admin-console__lead">{t("support.lead", { store: storeName })}</p>
      <ul className="admin-console__cards">
        {offers.map((offer) => (
          <OfferCard key={offer.id} offer={offer} coordinate={detail.coordinate} storeName={storeName} />
        ))}
      </ul>
    </section>
  );
}
