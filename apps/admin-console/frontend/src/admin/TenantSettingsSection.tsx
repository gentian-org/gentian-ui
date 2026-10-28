import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchTenantSettings,
  updateTenantSettings,
  type TenantAddress,
  type TenantOrganization,
  type TenantSettings,
} from "@/api/admin";
import "./admin.css";

/**
 * Who the tenant is: Tenant Settings.
 *
 * What an app needs to set itself up for this organisation rather than a
 * placeholder: its names, country, languages, currency, clock, address and
 * numbers. Each is declared in the tenant's manifest; the director commits
 * them and a component whose profile asks is told them. An app reads them
 * when it sets itself up, so a later change does not rewrite what an app
 * already holds -- which is why the console opens here while a required one
 * is missing, before anything is installed.
 */

/**
 * The languages offered: ISO 639-1, named in the reader's language by the
 * browser. The first chosen is the tenant's own.
 */
const LANGUAGES = [
  "de", "en", "fr", "it", "rm", "es", "pt", "nl", "da", "sv", "nb", "fi", "is", "pl", "cs", "sk",
  "hu", "ro", "bg", "hr", "sl", "sr", "el", "tr", "uk", "lt", "lv", "et", "ga", "mt", "ja", "zh",
  "ko", "ar", "he", "hi",
];

/** A code's name in a language, or the code where the browser knows none. */
function displayName(language: string, type: "region" | "language" | "currency", code: string): string {
  try {
    return new Intl.DisplayNames([language], { type, fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** What the browser can list, or nothing on one that cannot. */
function supported(key: "currency" | "timeZone"): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(key);
  } catch {
    return [];
  }
}

/** The zone this browser is in, offered while the tenant names none. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

type Form = Omit<TenantSettings, "missing">;

function formOf(settings: TenantSettings): Form {
  return {
    displayName: settings.displayName,
    country: settings.country,
    locales: settings.locales,
    organization: {
      ...settings.organization,
      timeZone: settings.organization.timeZone || browserTimeZone(),
    },
  };
}

export function TenantSettingsSection({ tenant }: { tenant: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["admin", "tenant-settings", tenant],
    queryFn: () => fetchTenantSettings(tenant),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setForm(formOf(settingsQuery.data));
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (body: Form) => updateTenantSettings(body, tenant),
    onSuccess: async () => {
      setError(null);
      setSuccess(t("tenantSettings.saved"));
      await queryClient.invalidateQueries({ queryKey: ["admin", "tenant-settings", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const currencies = useMemo(() => supported("currency"), []);
  const timeZones = useMemo(() => supported("timeZone"), []);
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(lang, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1))),
      ),
    [lang],
  );

  if (settingsQuery.isLoading || (settingsQuery.data && !form)) {
    return <p className="admin-console__loading">{t("tenantSettings.loading")}</p>;
  }
  if (settingsQuery.isError || !settingsQuery.data || !form) {
    return <p className="admin-console__error">{t("tenantSettings.unavailable")}</p>;
  }

  const missing = settingsQuery.data.missing;
  const org = form.organization;
  const address = org.address ?? {};
  const setOrg = (patch: Partial<TenantOrganization>) =>
    setForm((prev) => (prev ? { ...prev, organization: { ...prev.organization, ...patch } } : prev));
  const setAddress = (patch: Partial<TenantAddress>) => setOrg({ address: { ...address, ...patch } });

  const mainLanguage = form.locales[0] ?? "";
  const otherLanguages = form.locales.slice(1);
  const setMainLanguage = (code: string) =>
    setForm((prev) =>
      prev ? { ...prev, locales: code ? [code, ...prev.locales.slice(1).filter((l) => l !== code)] : [] } : prev,
    );
  const toggleOther = (code: string, on: boolean) =>
    setForm((prev) => {
      if (!prev || !prev.locales[0]) return prev;
      const others = prev.locales.slice(1).filter((l) => l !== code);
      return { ...prev, locales: [prev.locales[0], ...(on ? [...others, code] : others)] };
    });

  const countryIsValid = form.country === "" || /^[A-Z]{2}$/.test(form.country);
  const countryName = /^[A-Z]{2}$/.test(form.country) ? displayName(lang, "region", form.country) : null;
  // Required, as the director counts them; the field says so while it is empty.
  const required = (value: string | undefined) => (value ? undefined : t("tenantSettings.required"));

  const text = (id: string, label: string, value: string | undefined, onChange: (v: string) => void, opts: {
    type?: string;
    hint?: string;
    requiredHint?: string;
    placeholder?: string;
  } = {}) => (
    <div className="admin-console__field">
      <label className="admin-console__label" htmlFor={id}>
        <span className="admin-console__label-text">{label}</span>
        <input
          id={id}
          type={opts.type ?? "text"}
          value={value ?? ""}
          placeholder={opts.placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {opts.requiredHint ? (
        <p className="admin-console__field-error">{opts.requiredHint}</p>
      ) : opts.hint ? (
        <p className="admin-console__hint">{opts.hint}</p>
      ) : null}
    </div>
  );

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("tenantSettings.title")}</h2>
          <p className="admin-console__lead">{t("tenantSettings.lead")}</p>
        </div>
      </header>

      {missing.length > 0 && <p className="admin-console__warning">{t("tenantSettings.incomplete")}</p>}

      <form
        className="admin-console__form admin-console__form--wide"
        onSubmit={(event) => {
          event.preventDefault();
          setSuccess(null);
          saveMutation.mutate(form);
        }}
      >
        <fieldset className="admin-console__fieldset">
          <legend>{t("tenantSettings.organization")}</legend>
          {text("ts-display-name", t("tenantSettings.displayName"), form.displayName,
            (v) => setForm({ ...form, displayName: v }), { hint: t("tenantSettings.displayNameHint") })}
          {text("ts-legal-name", t("tenantSettings.legalName"), org.legalName, (v) => setOrg({ legalName: v }), {
            hint: t("tenantSettings.legalNameHint"),
            requiredHint: required(org.legalName),
          })}
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="ts-country">
              <span className="admin-console__label-text">{t("tenantSettings.country")}</span>
              <input
                id="ts-country"
                type="text"
                value={form.country}
                maxLength={2}
                autoComplete="off"
                placeholder={t("tenantSettings.countryPlaceholder")}
                onChange={(event) => setForm({ ...form, country: event.target.value.toUpperCase() })}
              />
            </label>
            <p className={countryIsValid && form.country ? "admin-console__hint" : "admin-console__field-error"}>
              {countryName
                ? t("tenantSettings.countryNamed", { country: countryName })
                : form.country
                  ? t("tenantSettings.countryHint")
                  : t("tenantSettings.required")}
            </p>
          </div>
        </fieldset>

        <fieldset className="admin-console__fieldset">
          <legend>{t("tenantSettings.languagesAndRegion")}</legend>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="ts-main-language">
              <span className="admin-console__label-text">{t("tenantSettings.mainLanguage")}</span>
              <select id="ts-main-language" value={mainLanguage} onChange={(e) => setMainLanguage(e.target.value)}>
                <option value="">{t("tenantSettings.choose")}</option>
                {LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {displayName(lang, "language", code)}
                  </option>
                ))}
              </select>
            </label>
            <p className={mainLanguage ? "admin-console__hint" : "admin-console__field-error"}>
              {mainLanguage ? t("tenantSettings.mainLanguageHint") : t("tenantSettings.required")}
            </p>
          </div>
          {mainLanguage && (
            <div className="admin-console__field">
              <span className="admin-console__label-text">{t("tenantSettings.otherLanguages")}</span>
              <div className="admin-console__checkbox-grid">
                {LANGUAGES.filter((code) => code !== mainLanguage).map((code) => (
                  <label key={code} className="admin-console__checkbox">
                    <input
                      type="checkbox"
                      checked={otherLanguages.includes(code)}
                      onChange={(e) => toggleOther(code, e.target.checked)}
                    />
                    {displayName(lang, "language", code)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="ts-currency">
              <span className="admin-console__label-text">{t("tenantSettings.currency")}</span>
              <select id="ts-currency" value={org.currency ?? ""} onChange={(e) => setOrg({ currency: e.target.value })}>
                <option value="">{t("tenantSettings.currencyFromCountry")}</option>
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {`${code} · ${displayName(lang, "currency", code)}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="admin-console__hint">{t("tenantSettings.currencyHint")}</p>
          </div>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="ts-time-zone">
              <span className="admin-console__label-text">{t("tenantSettings.timeZone")}</span>
              {timeZones.length > 0 ? (
                <select id="ts-time-zone" value={org.timeZone ?? ""} onChange={(e) => setOrg({ timeZone: e.target.value })}>
                  <option value="">{t("tenantSettings.choose")}</option>
                  {timeZones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="ts-time-zone"
                  type="text"
                  value={org.timeZone ?? ""}
                  placeholder={t("tenantSettings.timeZonePlaceholder")}
                  onChange={(e) => setOrg({ timeZone: e.target.value })}
                />
              )}
            </label>
            {!org.timeZone && <p className="admin-console__field-error">{t("tenantSettings.required")}</p>}
          </div>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="ts-fiscal-year">
              <span className="admin-console__label-text">{t("tenantSettings.fiscalYearStart")}</span>
              <select
                id="ts-fiscal-year"
                value={org.fiscalYearStartMonth ?? 1}
                onChange={(e) => setOrg({ fiscalYearStartMonth: Number(e.target.value) })}
              >
                {months.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="admin-console__fieldset">
          <legend>{t("tenantSettings.address")}</legend>
          {text("ts-street", t("tenantSettings.street"), address.street, (v) => setAddress({ street: v }))}
          {text("ts-postal-code", t("tenantSettings.postalCode"), address.postalCode, (v) => setAddress({ postalCode: v }))}
          {text("ts-city", t("tenantSettings.city"), address.city, (v) => setAddress({ city: v }))}
          {text("ts-region", t("tenantSettings.region"), address.region, (v) => setAddress({ region: v }), {
            hint: t("tenantSettings.regionHint"),
          })}
        </fieldset>

        <fieldset className="admin-console__fieldset">
          <legend>{t("tenantSettings.contact")}</legend>
          {text("ts-website", t("tenantSettings.website"), org.website, (v) => setOrg({ website: v }), {
            type: "url",
            placeholder: "https://",
          })}
          {text("ts-email", t("tenantSettings.email"), org.email, (v) => setOrg({ email: v }), { type: "email" })}
          {text("ts-phone", t("tenantSettings.phone"), org.phone, (v) => setOrg({ phone: v }), {
            type: "tel",
            placeholder: "+41 44 123 45 67",
          })}
          {text("ts-tax-id", t("tenantSettings.taxId"), org.taxId, (v) => setOrg({ taxId: v }), {
            hint: t("tenantSettings.taxIdHint"),
          })}
          {text("ts-registration", t("tenantSettings.registrationNumber"), org.registrationNumber,
            (v) => setOrg({ registrationNumber: v }), { hint: t("tenantSettings.registrationNumberHint") })}
        </fieldset>

        {error && <p className="admin-console__error">{error}</p>}
        {success && <p className="admin-console__success">{success}</p>}
        <button
          className="admin-console__btn admin-console__btn--primary"
          type="submit"
          disabled={saveMutation.isPending || !countryIsValid}
        >
          {saveMutation.isPending ? t("tenantSettings.saving") : t("tenantSettings.save")}
        </button>
      </form>
    </section>
  );
}
