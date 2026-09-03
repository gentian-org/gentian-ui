import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  emptyRetention,
  fetchBackupPolicy,
  fetchClusterBackupPolicy,
  escrowBackupKey,
  mintBackupKey,
  resetBackupPolicy,
  saveBackupPolicy,
  saveClusterBackupPolicy,
  type BackupPolicy,
  type BackupPolicyBody,
  type BackupRetention,
  type MintedKey,
} from "@/api/admin";
import { qrDataUrl, saveKeyFile, saveKeyQr } from "@/admin/backupKeyFile";
import {
  cronFrom,
  defaultSchedule,
  describeSchedule,
  formFromCron,
  WEEKDAYS,
  type Frequency,
  type ScheduleForm,
} from "@/admin/backupSchedule";
import "./admin.css";

type BackupPolicySectionProps = {
  tenant: string;
  isPlatformAdmin: boolean;
};

type StorageMode = "platform" | "external";
type KeyMode = "platform" | "own";

/** One key per line, so a tenant can name its own and the platform's together. */
function splitKeys(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Draft = {
  storage: StorageMode;
  endpoint: string;
  bucket: string;
  region: string;
  schedule: ScheduleForm;
  retention: BackupRetention;
  keyMode: KeyMode;
  /** Free text while typing; split into keys only on save. */
  keys: string;
  allowTenantOverride: boolean;
};

function draftFrom(policy: BackupPolicy | undefined): Draft {
  const endpoint = policy?.destination.endpoint ?? "";
  return {
    storage: endpoint ? "external" : "platform",
    endpoint,
    bucket: policy?.destination.bucket ?? "",
    region: policy?.destination.region ?? "",
    schedule: formFromCron(policy?.schedule ?? "", policy?.suspendSchedule ?? false),
    retention: policy?.retention ?? emptyRetention,
    keyMode: policy?.encryption.mode ?? "platform",
    keys: (policy?.encryption.recipients ?? []).join("\n"),
    allowTenantOverride: policy?.allowTenantOverride ?? true,
  };
}

function bodyFrom(draft: Draft, confirm?: string): BackupPolicyBody {
  const external = draft.storage === "external";
  return {
    destination: {
      endpoint: external ? draft.endpoint.trim() : "",
      bucket: draft.bucket.trim(),
      region: external ? draft.region.trim() : "",
    },
    schedule: cronFrom(draft.schedule),
    suspendSchedule: draft.schedule.frequency === "off",
    retention: draft.retention,
    encryption: {
      mode: draft.keyMode,
      // Cleared rather than kept when the platform key is chosen, so going back
      // actually goes back. A list left behind would keep writing bundles the
      // platform cannot read while the form said otherwise.
      recipients: draft.keyMode === "own" ? splitKeys(draft.keys) : [],
    },
    confirm,
  };
}

const RETENTION_TIERS: { key: keyof BackupRetention; label: string; hint: string }[] = [
  { key: "keepLast", label: "Most recent", hint: "kept whatever their age" },
  { key: "keepDaily", label: "Days", hint: "one per day" },
  { key: "keepWeekly", label: "Weeks", hint: "one per week" },
  { key: "keepMonthly", label: "Months", hint: "one per month" },
  { key: "keepYearly", label: "Years", hint: "one per year" },
];

function RetentionFields({
  value,
  onChange,
}: {
  value: BackupRetention;
  onChange: (next: BackupRetention) => void;
}) {
  const nothingKept = RETENTION_TIERS.every((t) => value[t.key] === 0);
  return (
    <>
      <div className="admin-console__field-row">
        {RETENTION_TIERS.map((tier) => (
          <label key={tier.key} className="admin-console__label">
            <span className="admin-console__label-text">{tier.label}</span>
            <input
              type="number"
              min={0}
              value={value[tier.key]}
              onChange={(e) => onChange({ ...value, [tier.key]: Number(e.target.value) || 0 })}
            />
            <span className="admin-console__hint">{tier.hint}</span>
          </label>
        ))}
      </div>
      <p className="admin-console__hint">
        {nothingKept
          ? "Nothing is deleted automatically. Backups accumulate until you remove them."
          : "A backup kept by any row is kept. Older ones are deleted."}
      </p>
    </>
  );
}

function ScheduleFields({
  value,
  onChange,
  allowInherit,
  inherited,
}: {
  value: ScheduleForm;
  onChange: (next: ScheduleForm) => void;
  allowInherit: boolean;
  inherited: string;
}) {
  const showTime = ["daily", "weekly", "monthly"].includes(value.frequency);
  return (
    <div className="admin-console__stack">
      <div className="admin-console__field-row">
        <label className="admin-console__label">
          <span className="admin-console__label-text">How often</span>
          <select
            value={value.frequency}
            onChange={(e) => onChange({ ...value, frequency: e.target.value as Frequency })}
          >
            {allowInherit && <option value="inherit">Same as the cluster</option>}
            <option value="off">Never — only when I start one</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="custom">Custom (cron)</option>
          </select>
        </label>

        {value.frequency === "weekly" && (
          <label className="admin-console__label">
            <span className="admin-console__label-text">Day</span>
            <select
              value={value.weekday}
              onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}

        {value.frequency === "monthly" && (
          <label className="admin-console__label">
            <span className="admin-console__label-text">Day of month</span>
            <select
              value={value.monthday}
              onChange={(e) => onChange({ ...value, monthday: Number(e.target.value) })}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}

        {showTime && (
          <label className="admin-console__label">
            <span className="admin-console__label-text">Start at (UTC)</span>
            <input
              type="time"
              value={value.time}
              onChange={(e) => onChange({ ...value, time: e.target.value })}
            />
            <span className="admin-console__hint">one run, not a window</span>
          </label>
        )}
      </div>

      {value.frequency === "custom" && (
        <label className="admin-console__label">
          <span className="admin-console__label-text">Cron expression (UTC)</span>
          <input
            placeholder="0 3 * * *"
            value={value.custom}
            onChange={(e) => onChange({ ...value, custom: e.target.value })}
          />
        </label>
      )}

      <p className="admin-console__hint">{describeSchedule(value, inherited)}</p>
    </div>
  );
}

function StorageFields({
  draft,
  setDraft,
  platformLabel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  platformLabel: string;
}) {
  return (
    <div className="admin-console__stack">
      <label className="admin-console__label">
        <span className="admin-console__label-text">Where backups are stored</span>
        <select
          value={draft.storage}
          onChange={(e) => setDraft({ ...draft, storage: e.target.value as StorageMode })}
        >
          <option value="platform">{platformLabel}</option>
          <option value="external">External storage (S3-compatible)</option>
        </select>
      </label>

      {draft.storage === "external" && (
        <>
          <label className="admin-console__label">
            <span className="admin-console__label-text">Endpoint</span>
            <input
              placeholder="https://sos-ch-gva-2.exo.io"
              value={draft.endpoint}
              onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
            />
            <span className="admin-console__hint">
              The provider&apos;s S3 address, including https://
            </span>
          </label>
          <label className="admin-console__label">
            <span className="admin-console__label-text">Region</span>
            <input
              placeholder="ch-gva-2"
              value={draft.region}
              onChange={(e) => setDraft({ ...draft, region: e.target.value })}
            />
            <span className="admin-console__hint">Required by some providers; leave empty if unsure</span>
          </label>
        </>
      )}

      <label className="admin-console__label">
        <span className="admin-console__label-text">Bucket</span>
        <input
          placeholder={draft.storage === "external" ? "my-backups" : "leave empty for the default"}
          value={draft.bucket}
          onChange={(e) => setDraft({ ...draft, bucket: e.target.value })}
        />
      </label>
    </div>
  );
}

/** Which key backups are encrypted to — the platform's, or one you hold.
 *
 * The consequential choice on this page and the one with no undo, so the words
 * are spent on the consequence and nothing else. Choosing your own key is a
 * button: it mints one, hands you the file and a printable QR, and fills the
 * form in. Typing a key by hand is the rarer case and sits behind a link.
 */
function EncryptionFields({
  tenant,
  draft,
  setDraft,
  minted,
  onMint,
  minting,
  escrow,
  onEscrowChange,
  escrowed,
}: {
  tenant: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  minted: MintedKey | null;
  onMint: () => void;
  minting: boolean;
  escrow: boolean;
  onEscrowChange: (next: boolean) => void;
  /** null until a mint settles: true kept, false attempted and failed. */
  escrowed: boolean | null;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  // The QR is derived from the key, so it is rendered when one appears rather
  // than waiting for a click: seeing the thing you are about to print is what
  // makes "save this" a decision instead of an instruction.
  useEffect(() => {
    if (!minted) {
      setQr(null);
      return;
    }
    let live = true;
    qrDataUrl(minted).then(
      (url) => live && setQr(url),
      () => live && setQr(null),
    );
    return () => {
      live = false;
    };
  }, [minted]);

  const own = draft.keyMode === "own";
  const hasKey = splitKeys(draft.keys).length > 0;

  return (
    <div className="admin-console__stack">
      <label className="admin-console__label">
        <span className="admin-console__label-text">Who can read the backups</span>
        <select
          value={draft.keyMode}
          onChange={(e) => setDraft({ ...draft, keyMode: e.target.value as KeyMode })}
        >
          <option value="platform">The platform&apos;s key (recommended)</option>
          <option value="own">A key only you hold</option>
        </select>
        <span className="admin-console__hint">
          {own
            ? "Nobody here can read them, including your provider. Restoring is yours alone to do."
            : "Your provider can open a backup, so they can help you restore one."}
        </span>
      </label>

      {own && !hasKey && !pasting && (
        <div className="admin-console__submit">
          <label className="admin-console__checkbox">
            <input type="checkbox" checked={escrow} onChange={(e) => onEscrowChange(e.target.checked)} />
            <span>
              Keep a copy in the vault
              <span className="admin-console__hint">
                {escrow
                  ? "You can restore without the downloaded file. A workspace administrator can read the key; the platform cannot."
                  : "The download is the only copy. Lose it and these backups are unreadable by anyone."}
              </span>
            </span>
          </label>
          <button
            type="button"
            className="admin-console__btn admin-console__btn--primary"
            disabled={minting}
            onClick={onMint}
          >
            {minting ? "Generating…" : "Generate backup key"}
          </button>
          <button type="button" className="admin-console__btn-link" onClick={() => setPasting(true)}>
            I already have a key
          </button>
        </div>
      )}

      {own && (pasting || (hasKey && !minted)) && (
        <label className="admin-console__label">
          <span className="admin-console__label-text">Your public key</span>
          <textarea
            rows={2}
            spellCheck={false}
            placeholder="age1…"
            value={draft.keys}
            onChange={(e) => setDraft({ ...draft, keys: e.target.value })}
          />
          <span className="admin-console__hint">
            The <code>age1</code> line from <code>age-keygen</code>. One per line.
          </span>
        </label>
      )}

      {own && minted && (
        <div className="admin-console__keycard">
          <p className="admin-console__keycard-lead">
            {escrowed
              ? "A copy is in the vault, so this download is not your only one — but the vault goes with the cluster. Save it anyway."
              : escrowed === false
                ? "Could not keep a vault copy, so this download is the only one. Save it now."
                : "Shown once and stored nowhere. Without it these backups cannot be opened by anyone, including you."}
          </p>
          <div className="admin-console__keycard-body">
            {qr && (
              <img
                className="admin-console__keycard-qr"
                src={qr}
                alt="Your backup key as a QR code, for printing"
                width={160}
                height={160}
              />
            )}
            <div className="admin-console__submit admin-console__submit--stack">
              <button
                type="button"
                className="admin-console__btn admin-console__btn--primary"
                onClick={() => saveKeyFile(minted, tenant)}
              >
                Save key file
              </button>
              <button
                type="button"
                className="admin-console__btn"
                onClick={() => void saveKeyQr(minted, tenant)}
              >
                Save QR as PNG
              </button>
              <span className="admin-console__hint">
                Print the QR and keep it somewhere physical. A copy only on the machine you
                would be restoring is no copy at all.
              </span>
            </div>
          </div>
        </div>
      )}

      {own && hasKey && (
        <p className="admin-console__hint">
          Applies from the next backup. Ones already taken keep the key they were written
          with and are still restorable.
        </p>
      )}
    </div>
  );
}

/** What applies after inheritance, and whether it can actually be used. */
function EffectiveSummary({ policy }: { policy: BackupPolicy }) {
  const where = policy.effectiveEndpoint
    ? `${policy.effectiveEndpoint}/${policy.effectiveBucket}`
    : `${policy.effectiveBucket} (platform storage)`;
  return (
    <div className="admin-console__card-footer">
      <p className="admin-console__card-meta">
        In force: <code>{where}</code>
        {policy.effectiveSchedule ? ` · ${policy.effectiveSchedule} UTC` : " · no schedule"}
        {policy.effectiveRecipients.length > 0
          ? " · encrypted to your own key"
          : " · encrypted to the platform's key"}
      </p>
      {policy.credentialRequirement && !policy.credentialSatisfied && (
        <p className="admin-console__warning">
          Waiting for the storage keys. Supply <code>{policy.credentialRequirement}</code> in the
          Credentials tab — until then, backups to this destination cannot run.
        </p>
      )}
    </div>
  );
}

export function BackupPolicySection({ tenant, isPlatformAdmin }: BackupPolicySectionProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clusterQuery = useQuery({
    queryKey: ["admin", "backup-policy", "cluster"],
    queryFn: fetchClusterBackupPolicy,
    enabled: isPlatformAdmin,
  });
  const tenantQuery = useQuery({
    queryKey: ["admin", "backup-policy", tenant],
    queryFn: () => fetchBackupPolicy(tenant),
  });

  const [clusterDraft, setClusterDraft] = useState<Draft>(() => draftFrom(undefined));
  const [tenantDraft, setTenantDraft] = useState<Draft>(() => draftFrom(undefined));
  const [overriding, setOverriding] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  // Held in this component and never sent back: the private key exists in this
  // response and nowhere else, so it must not survive a page reload either.
  const [minted, setMinted] = useState<MintedKey | null>(null);
  // Escrow on by default, matching the cluster's own arrangement: the likelier
  // loss is a download that never got saved, not a vault that got breached.
  const [escrow, setEscrow] = useState(true);
  const [escrowed, setEscrowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (clusterQuery.data) {
      const d = draftFrom(clusterQuery.data);
      // The cluster has nothing to inherit from.
      setClusterDraft({
        ...d,
        schedule: d.schedule.frequency === "inherit" ? { ...defaultSchedule, frequency: "off" } : d.schedule,
      });
    }
  }, [clusterQuery.data]);

  useEffect(() => {
    if (!tenantQuery.data) return;
    setTenantDraft(draftFrom(tenantQuery.data));
    setOverriding(tenantQuery.data.configured);
  }, [tenantQuery.data]);

  const settled = (message: string) => async () => {
    setError(null);
    setSuccess(message);
    setConfirmName("");
    await queryClient.invalidateQueries({ queryKey: ["admin", "backup-policy"] });
  };
  const failed = (err: Error) => {
    setSuccess(null);
    setError(err.message);
  };

  const saveCluster = useMutation({
    mutationFn: () =>
      saveClusterBackupPolicy({
        ...bodyFrom(clusterDraft),
        allowTenantOverride: clusterDraft.allowTenantOverride,
      }),
    onSuccess: settled("Cluster default saved."),
    onError: failed,
  });
  const saveTenant = useMutation({
    mutationFn: () => saveBackupPolicy(bodyFrom(tenantDraft, confirmName.trim()), tenant),
    onSuccess: settled("Backup settings saved."),
    onError: failed,
  });
  const reset = useMutation({
    mutationFn: () => resetBackupPolicy(tenant),
    onSuccess: settled("Back to the cluster settings."),
    onError: failed,
  });
  const mint = useMutation({
    mutationFn: async () => {
      const key = await mintBackupKey(tenant);
      if (!escrow) return { key, escrowed: null };
      // A failed escrow is not a failed mint. The key exists either way, and
      // discarding it because the copy could not be stored would be the worse
      // outcome — so the result is reported on the card and the download is
      // still offered.
      try {
        await escrowBackupKey(key.identity);
        return { key, escrowed: true };
      } catch {
        return { key, escrowed: false };
      }
    },
    onSuccess: ({ key, escrowed: kept }) => {
      setError(null);
      setEscrowed(kept);
      setMinted(key);
      // The public half goes straight into the form. Asking someone to copy it
      // out of one box and into another is a step that can only go wrong, and
      // pasting the wrong half is the mistake that would silently put the
      // private key in a spec.
      setTenantDraft((d) => ({ ...d, keyMode: "own", keys: key.recipient }));
    },
    onError: failed,
  });

  const clusterPolicy = clusterQuery.data;
  const tenantPolicy = tenantQuery.data;
  const movingStorage = tenantDraft.storage === "external" && tenantDraft.endpoint.trim() !== "";
  const ownKeyIncomplete = tenantDraft.keyMode === "own" && splitKeys(tenantDraft.keys).length === 0;
  const overrideBlocked = clusterPolicy ? !clusterPolicy.allowTenantOverride : false;

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">Backup settings</h2>
          <p className="admin-console__lead">
            Where backups are stored, when they run, and how long they are kept.
          </p>
        </div>
      </header>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      {isPlatformAdmin && (
        <div className="admin-console__subsection">
          <h3 className="admin-console__subsection-title">Cluster settings</h3>
          <p className="admin-console__hint">
            The default for every tenant that has not chosen its own.
          </p>

          <StorageFields
            draft={clusterDraft}
            setDraft={setClusterDraft}
            platformLabel="This cluster's own storage"
          />

          <h4 className="admin-console__group-title">When backups run</h4>
          <ScheduleFields
            value={clusterDraft.schedule}
            onChange={(schedule) => setClusterDraft({ ...clusterDraft, schedule })}
            allowInherit={false}
            inherited=""
          />

          <h4 className="admin-console__group-title">How many to keep</h4>
          <RetentionFields
            value={clusterDraft.retention}
            onChange={(retention) => setClusterDraft({ ...clusterDraft, retention })}
          />

          <label className="admin-console__checkbox">
            <input
              type="checkbox"
              checked={clusterDraft.allowTenantOverride}
              onChange={(e) =>
                setClusterDraft({ ...clusterDraft, allowTenantOverride: e.target.checked })
              }
            />
            <span>
              Tenant admins may choose their own storage provider.
              {clusterDraft.allowTenantOverride
                ? " Their backups then sit outside this cluster, and you need their keys to help them restore."
                : " Every tenant's backups stay where you control them, and you can restore any of them."}
            </span>
          </label>

          <div className="admin-console__submit">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={saveCluster.isPending}
              onClick={() => saveCluster.mutate()}
            >
              {saveCluster.isPending ? "Saving…" : "Save default"}
            </button>
          </div>

          {clusterPolicy && <EffectiveSummary policy={clusterPolicy} />}
        </div>
      )}

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{titleCase(tenant)} settings</h3>

        {!overriding && (
          <>
            <p className="admin-console__hint">
              {tenantPolicy?.effectiveSchedule
                ? `Backups run ${tenantPolicy.effectiveSchedule} UTC, stored in ${
                    tenantPolicy.effectiveEndpoint || "the platform's storage"
                  }.`
                : "No scheduled backups. You can start one at any time from the list below."}
            </p>
            {overrideBlocked ? (
              <p className="admin-console__hint">
                Your provider has fixed these settings for every tenant on this cluster.
              </p>
            ) : (
              <button
                type="button"
                className="admin-console__btn"
                onClick={() => setOverriding(true)}
              >
                Change for {tenant}
              </button>
            )}
          </>
        )}

        {overriding && (
          <>
            <h4 className="admin-console__group-title">When backups run</h4>
            <ScheduleFields
              value={tenantDraft.schedule}
              onChange={(schedule) => setTenantDraft({ ...tenantDraft, schedule })}
              allowInherit
              inherited={clusterPolicy?.effectiveSchedule ?? ""}
            />

            <h4 className="admin-console__group-title">How many to keep</h4>
            <RetentionFields
              value={tenantDraft.retention}
              onChange={(retention) => setTenantDraft({ ...tenantDraft, retention })}
            />

            {!overrideBlocked && (
              <>
                <h4 className="admin-console__group-title">Where backups are stored</h4>
                <StorageFields
                  draft={tenantDraft}
                  setDraft={setTenantDraft}
                  platformLabel="The platform's storage (recommended)"
                />
              </>
            )}

            <h4 className="admin-console__group-title">Who can read the backups</h4>
            <EncryptionFields
              tenant={tenant}
              draft={tenantDraft}
              setDraft={setTenantDraft}
              minted={minted}
              onMint={() => mint.mutate()}
              minting={mint.isPending}
              escrow={escrow}
              onEscrowChange={setEscrow}
              escrowed={escrowed}
            />

            {movingStorage && (
              <div className="admin-console__warning">
                <p>
                  Backups will be written to your storage instead of the platform&apos;s.
                  Recovering then starts by fetching a backup from there, so it depends on that
                  storage being reachable and the keys staying valid.
                </p>
                <p>Backups already taken stay where they are and can still be restored.</p>
                <label className="admin-console__label">
                  <span className="admin-console__label-text">
                    Type <code>{tenant}</code> to confirm
                  </span>
                  <input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            )}

            <div className="admin-console__submit">
              <button
                type="button"
                className="admin-console__btn admin-console__btn--primary"
                disabled={
                  saveTenant.isPending ||
                  ownKeyIncomplete ||
                  (movingStorage && confirmName.trim() !== tenant)
                }
                onClick={() => saveTenant.mutate()}
              >
                {saveTenant.isPending ? "Saving…" : "Save"}
              </button>
              {tenantPolicy?.configured && (
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  disabled={reset.isPending}
                  onClick={() => {
                    if (window.confirm("Go back to the cluster settings?")) reset.mutate();
                  }}
                >
                  Use the cluster settings
                </button>
              )}
            </div>
          </>
        )}

        {tenantPolicy && <EffectiveSummary policy={tenantPolicy} />}
      </div>
    </section>
  );
}
