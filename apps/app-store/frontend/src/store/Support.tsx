import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemOf } from "@/api/client";
import {
  fetchContext,
  fetchSupport,
  requestSupport,
  type AppDetail,
  type StoreMeta,
  type SupportOffer,
  type SupportReceipt,
} from "@/api/store";
import { countryOptions, keepCountryChoice, readCountryChoice } from "@/lib/countries";
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
 *
 * The offers are asked for the tenant's country by default, and for the one
 * chosen in the switch otherwise -- or for none, where the store lists what it
 * has. The choice holds for the browser session.
 */

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

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
      {/* What is passed on, said where the request is written: the form,
          and so its send button, exists only with this notice in it. */}
      <p className="store-support__consent" role="note">
        {t("support.consent", { partner: offer.partner.name })}
      </p>
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

/**
 * One partner's offer, on a few lines: who, where and in which languages,
 * the tiers by name and the price hint, and one button -- the request where
 * the store takes one, the partner's contact page otherwise.
 */
function OfferCard({ offer, coordinate, storeName }: { offer: SupportOffer; coordinate: string; storeName: string }) {
  const { t } = useTranslation();
  const { partner } = offer;
  const countries = offer.countries.map((code) => displayName("region", code)).join(", ");
  const languages = offer.languages.map((code) => displayName("language", code)).join(", ");
  const facts = [
    countries ? t("support.countries", { countries }) : t("support.worldwide"),
    languages ? t("support.languages", { languages }) : null,
    offer.tiers.length > 0 ? offer.tiers.map((tier) => tier.name).join(", ") : null,
    offer.priceHint,
  ].filter(Boolean);
  const contact = offer.contactUrl && offer.contactUrl.startsWith("https://") ? offer.contactUrl : null;
  return (
    <li className="store-support__offer">
      <Picture src={partner.logoUrl} alt="" className="store-support__logo" initialOf={partner.name} />
      <div className="store-support__main">
        <p className="store-support__name">
          <ExternalLink href={partner.url}>{partner.name}</ExternalLink>
          {partner.verified ? <span className="admin-console__badge admin-console__badge--ok">{t("support.verified")}</span> : null}
        </p>
        <p className="admin-console__meta">{facts.join(" · ")}</p>
        {offer.requestable ? (
          <RequestForm offer={offer} coordinate={coordinate} storeName={storeName} />
        ) : contact ? (
          <div className="admin-console__actions">
            <a className="admin-console__btn" href={contact} target="_blank" rel="noopener noreferrer">
              {t("support.contact")}
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CountrySwitch({ value, onChange }: { value: string; onChange: (country: string) => void }) {
  const { t } = useTranslation();
  const language = i18n.resolvedLanguage ?? "en";
  const options = useMemo(() => countryOptions(language), [language]);
  return (
    <label className="admin-console__label store-support__country">
      <span className="admin-console__label-text">{t("support.country")}</span>
      <select className="store-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("support.allCountries")}</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Support({ detail, meta, storeName }: { detail: AppDetail; meta: StoreMeta | undefined; storeName: string }) {
  const { t } = useTranslation();
  const contextQuery = useQuery({ queryKey: ["context"], queryFn: fetchContext, retry: false });
  // null: nothing chosen in this session, so the tenant's country -- which
  // the entry's own offers were already asked for.
  const [choice, setChoice] = useState<string | null>(() => readCountryChoice(sessionStore()));
  const tenantCountry = contextQuery.data?.tenantCountry ?? "";
  const country = choice ?? tenantCountry;
  const supported = meta?.features.includes("support") === true;
  const switched = useQuery({
    queryKey: ["store", "support", detail.coordinate, country],
    queryFn: () => fetchSupport(detail.coordinate, country),
    enabled: supported && choice !== null,
    retry: false,
  });
  if (!supported) return null;
  const offers = choice === null ? (detail.support ?? []) : (switched.data?.items ?? []);
  // A store with no offer for the app anywhere: nothing to show, nor to switch.
  if (offers.length === 0 && country === "" && !switched.isLoading) return null;
  return (
    <section className="store-support">
      <p className="admin-console__meta">{t("support.lead", { store: storeName })}</p>
      <CountrySwitch
        value={country}
        onChange={(next) => {
          keepCountryChoice(sessionStore(), next);
          setChoice(next);
        }}
      />
      {switched.error ? <ProblemNote error={switched.error} /> : null}
      {offers.length > 0 ? (
        <ul className="store-support__offers">
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} coordinate={detail.coordinate} storeName={storeName} />
          ))}
        </ul>
      ) : switched.isLoading ? null : (
        <p className="admin-console__empty">{t("support.noneIn")}</p>
      )}
    </section>
  );
}
