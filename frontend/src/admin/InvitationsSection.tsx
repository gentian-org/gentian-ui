import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  inviteMember,
  type AdminGroup,
} from "@/api/admin";
import { fetchTemplates } from "@/api/prefs";
import "./admin.css";

type InvitationsSectionProps = {
  tenant: string;
  /** Cluster kernel domain from GET /admin/context — never inferred locally. */
  kernelDomain: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
};

/** Extract the app-id slug from a group name like `...:app:xwiki` → `xwiki` */
function appIdFromGroup(name: string): string | null {
  const m = name.match(/:app:([^:]+)$/);
  return m ? m[1] : null;
}

/** Human-readable label from a full group name. */
function groupLabel(name: string): string {
  if (name.endsWith(":app-admins")) return "App Admin";
  const appMatch = name.match(/:app:([^:]+)$/);
  if (appMatch) return appMatch[1];
  return name;
}

/**
 * The editable part of a login address. The character set is deliberately
 * narrow — the domain is fixed and shown beside the field, so anything outside
 * [a-z0-9-_] does not belong in what the operator types here.
 */
function sanitizeLocalPart(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

/** The address suggested from a name, until the operator edits it themselves. */
function suggestLocalPart(first: string, last: string): string {
  const cleanFirst = first.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanLast = last.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleanFirst && cleanLast) {
    return `${cleanFirst}-${cleanLast}`;
  }
  return cleanFirst || cleanLast || "";
}

/**
 * Focusing a text field with Tab makes the browser select its whole value, so
 * the next keystroke replaces it. That convention exists for fields holding a
 * default worth overwriting; here it fights the form, because the login
 * address is generated from the name and is usually adjusted rather than
 * retyped — and tabbing between fields is how this form gets filled in.
 *
 * So the caret goes to the end instead. A pointer places its own caret on
 * mouseup, after focus, so clicking is unaffected and needs no special case.
 */
function caretToEndOnFocus(event: React.FocusEvent<HTMLInputElement>) {
  const field = event.currentTarget;
  const { value } = field;
  if (!value) {
    return;
  }
  try {
    field.setSelectionRange(value.length, value.length);
  } catch {
    // An email input exposes no selection API at all, so it has to be a text
    // input for as long as it takes to move the cursor. Re-assigning the value
    // is not enough: the browser skips the write when the string is unchanged,
    // and the selection survives.
    field.type = "text";
    try {
      field.setSelectionRange(value.length, value.length);
    } finally {
      field.type = "email";
    }
  }
}

/** A single labelled section block inside the invite form. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="admin-console__invite-section">
      <div className="admin-console__invite-section-label">{title}</div>
      <div className="admin-console__invite-section-body">{children}</div>
    </div>
  );
}

/** One toggle pill with an optional tooltip shown on hover. */
function TogglePill({
  label,
  active,
  onToggle,
  tooltip,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      className={`admin-console__toggle${active ? " admin-console__toggle--on" : ""}`}
      onClick={onToggle}
    >
      <span className="admin-console__toggle-icon">
        {active ? "☑" : "☐"}
      </span>
      {label}
    </button>
  );
}

/**
 * A tenant member's login domain: <tenant>.<kernel-domain>.
 *
 * kernelDomain comes from the server (GET /admin/context). It used to be
 * inferred from window.location.hostname by stripping a "portal." prefix, which
 * is only correct when the console is opened at portal.<kernel-domain>. The
 * portal is deliberately served on each tenant's own host as well, and there
 * nothing was stripped: the whole hostname became the base domain and the
 * tenant name was prepended to it a second time, so inviting a user from
 * corp.gtn.host generated an address at corp.corp.gtn.host — and identically at
 * demo.desk.gentian.org on the test cluster.
 *
 * It also fell back to a hardcoded "desk.gentian.org" for any hostname without
 * a dot, which would silently issue another cluster's addresses.
 */
function tenantLoginDomain(tenant: string, kernelDomain: string): string {
  return `${tenant}.${kernelDomain}`;
}

export function InvitationsSection({
  tenant,
  kernelDomain,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
}: InvitationsSectionProps) {
  const queryClient = useQueryClient();
  const tenantDomain = tenantLoginDomain(tenant, kernelDomain);

  // ── Filter out admin-only app IDs from the visible entitlement groups ──────
  const visibleAppGroups = useMemo(() => {
    return appEntitlementGroups.filter((g) => {
      const appId = appIdFromGroup(g.name);
      if (appId === null) return false;
      const adminAppIds = ["app-store", "subscriptions", "gentian-subscriptions", "admin"];
      return !adminAppIds.includes(appId);
    });
  }, [appEntitlementGroups]);

  // ── Default group selection: the apps the tenant provisioned ──────────────
  //
  // Provision and Install differ in the App Store by whether every existing user
  // is granted the app, and the operator records which was chosen on the group.
  // That is the same question being asked here about a user who does not exist
  // yet, so the answer is the same: provisioned apps come ticked and are opted
  // out of, installed ones come unticked and are opted in to.
  //
  // This used to tick every app group, which made the choice at install time
  // mean nothing for anybody hired afterwards.
  const defaultAppGroupIds = useCallback(
    () => visibleAppGroups.filter((g) => g.defaultGrant).map((g) => g.id),
    [visibleAppGroups],
  );

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    inviteEmail: "",
    appGroupIds: [] as string[],
    adminGroupIds: [] as string[],
    requireTotp: false,
  });

  const [localPart, setLocalPart] = useState("");
  const [hasManuallyEditedLocalPart, setHasManuallyEditedLocalPart] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settingsTemplateId, setSettingsTemplateId] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["admin", "templates", tenant],
    queryFn: () => fetchTemplates(),
  });
  const templates = templatesQuery.data ?? [];

  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize app defaults once when apps are loaded
  useEffect(() => {
    if (visibleAppGroups.length > 0 && !isInitialized) {
      setForm((prev) => ({ ...prev, appGroupIds: defaultAppGroupIds() }));
      setIsInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppGroups, isInitialized]);

  // Handle name updates and auto-population of Login email.
  //
  // Both updates are made from the handler, not from inside the setForm
  // updater. A state updater has to be a pure function of the previous state —
  // React may call it more than once, and setLocalPart was riding along each
  // time it did.
  const handleNameChange = (field: "firstName" | "lastName", val: string) => {
    const first = field === "firstName" ? val : form.firstName;
    const last = field === "lastName" ? val : form.lastName;
    setForm((prev) => ({ ...prev, [field]: val }));
    if (!hasManuallyEditedLocalPart) {
      setLocalPart(suggestLocalPart(first, last));
    }
  };

  const handleLocalPartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalPart(sanitizeLocalPart(e.target.value));
    setHasManuallyEditedLocalPart(true);
  };

  const toggleId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember(
        {
          email: `${localPart}@${tenantDomain}`,
          inviteEmail: form.inviteEmail || undefined,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          groupIds: [...form.appGroupIds, ...form.adminGroupIds],
          requireTotp: form.requireTotp,
          settingsTemplateId: settingsTemplateId || undefined,
        },
        tenant,
      ),
    onSuccess: async () => {
      setForm({
        firstName: "",
        lastName: "",
        inviteEmail: "",
        appGroupIds: defaultAppGroupIds(),
        adminGroupIds: [],
        requireTotp: false,
      });
      setLocalPart("");
      setHasManuallyEditedLocalPart(false);
      setSettingsTemplateId("");
      setError(null);
      setSuccess("Invite sent.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__section-title">
          Invite member
        </h2>
      </div>

      {/*
        autoComplete="off" throughout, and field names that do not read as a
        person's own details.

        This form is first name + last name + email — the exact shape a browser
        classifies as an address form, so it offers the operator's own saved
        profile and inline-completes it as they type, selecting the completion
        on every keystroke. But the operator is not the person being invited:
        every value here belongs to somebody else, so there is nothing on file
        that is ever the right suggestion.
      */}
      <form
        className="admin-console__form admin-console__form--invite"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          setSuccess(null);
          inviteMutation.mutate();
        }}
      >
        {/* ── Identity fields stacked in ordered rows ──────────────────── */}
        <div className="admin-console__invite-fields">
          {/* Row 1: First Name and Last Name */}
          <div className="admin-console__field-row">
            <div className="admin-console__field">
              <label htmlFor="inv-first">First name</label>
              <input
                id="inv-first"
                onFocus={caretToEndOnFocus}
                name="invitee-given"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.firstName}
                onChange={(e) => handleNameChange("firstName", e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="admin-console__field">
              <label htmlFor="inv-last">Last name</label>
              <input
                id="inv-last"
                onFocus={caretToEndOnFocus}
                name="invitee-family"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.lastName}
                onChange={(e) => handleNameChange("lastName", e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>

          {/* Row 2: Login email (Custom editable localpart + static domain) */}
          <div className="admin-console__field">
            <label htmlFor="inv-email-local">Login email</label>
            <div className="admin-console__email-input-wrapper">
              <input
                id="inv-email-local"
                onFocus={caretToEndOnFocus}
                name="invitee-login-local"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                type="text"
                required
                value={localPart}
                onChange={handleLocalPartChange}
                placeholder="john-doe"
              />
              <span className="admin-console__email-domain">@{tenantDomain}</span>
            </div>
          </div>

          {/* Row 3: Invite email */}
          <div className="admin-console__field">
            <label htmlFor="inv-invite-email">Invite email</label>
            <input
              id="inv-invite-email"
              onFocus={caretToEndOnFocus}
              name="invitee-delivery"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              type="email"
              required
              value={form.inviteEmail}
              onChange={(e) => setForm((p) => ({ ...p, inviteEmail: e.target.value }))}
              placeholder="personal@example.com"
            />
          </div>

          {/* Row 4: Settings template */}
          <div className="admin-console__field">
            <label htmlFor="inv-settings-template">Settings template to apply</label>
            <select
              id="inv-settings-template"
              value={settingsTemplateId}
              onChange={(e) => setSettingsTemplateId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--gtn-r1)", border: "1px solid var(--gtn-border)", background: "var(--gtn-paper-3)", color: "var(--gtn-ink-1)" }}
            >
              <option value="">-- None (use defaults) --</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Rights ───────────────────────────────────────────────────── */}
        <FormSection title="Rights">
          {privilegeGroups.map((g) => (
            <TogglePill
              key={g.id}
              label="App Admin"
              active={form.adminGroupIds.includes(g.id)}
              onToggle={() =>
                setForm((p) => ({ ...p, adminGroupIds: toggleId(p.adminGroupIds, g.id) }))
              }
              tooltip="Grants administrator access to a specific application. App admins can manage app-level settings and users within that app."
            />
          ))}
          {privilegeGroups.length === 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              No privilege groups defined.
            </span>
          )}
        </FormSection>

        {/* ── Apps ─────────────────────────────────────────────────────── */}
        <FormSection title="Apps">
          {visibleAppGroups.length === 0 ? (
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              No installed apps found.
            </span>
          ) : (
            visibleAppGroups.map((g) => {
              const appId = appIdFromGroup(g.name) ?? groupLabel(g.name);
              return (
                <TogglePill
                  key={g.id}
                  label={appId}
                  active={form.appGroupIds.includes(g.id)}
                  onToggle={() =>
                    setForm((p) => ({ ...p, appGroupIds: toggleId(p.appGroupIds, g.id) }))
                  }
                  tooltip={`Grant access to the "${appId}" application. When active, the member will be added to the app's entitlement group and can sign in to ${appId}.`}
                />
              );
            })
          )}
        </FormSection>

        {/* ── Custom groups (if any) ────────────────────────────────────── */}
        {customGroups.length > 0 && (
          <FormSection title="Custom groups">
            {customGroups.map((g) => (
              <TogglePill
                key={g.id}
                label={groupLabel(g.name)}
                active={form.adminGroupIds.includes(g.id)}
                onToggle={() =>
                  setForm((p) => ({ ...p, adminGroupIds: toggleId(p.adminGroupIds, g.id) }))
                }
                tooltip={`Add the member to the custom group "${g.name}".`}
              />
            ))}
          </FormSection>
        )}

        {/* ── Requirements ─────────────────────────────────────────────── */}
        <FormSection title="Requirements">
          <TogglePill
            label="Require TOTP"
            active={form.requireTotp}
            onToggle={() => setForm((p) => ({ ...p, requireTotp: !p.requireTotp }))}
            tooltip="Force the member to enrol a TOTP authenticator app (e.g. Google Authenticator) on their very first login before they can access anything."
          />
        </FormSection>

        {error && <p className="admin-console__error">{error}</p>}
        {success && <p className="admin-console__success">{success}</p>}

        <div className="admin-console__form-footer">
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="submit"
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? "Sending invite…" : "Send invite"}
          </button>
        </div>
      </form>
    </section>
  );
}
