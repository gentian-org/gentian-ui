import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  emptyRetention,
  fetchBackupPolicy,
  fetchClusterBackupPolicy,
  resetBackupPolicy,
  saveBackupPolicy,
  saveClusterBackupPolicy,
  type BackupPolicy,
  type BackupPolicyBody,
  type BackupRetention,
} from "@/api/admin";
import "./admin.css";

type BackupPolicySectionProps = {
  tenant: string;
  isPlatformAdmin: boolean;
};

type Draft = {
  endpoint: string;
  bucket: string;
  region: string;
  schedule: string;
  suspendSchedule: boolean;
  retention: BackupRetention;
  allowTenantOverride: boolean;
};

function draftFrom(policy: BackupPolicy | undefined): Draft {
  return {
    endpoint: policy?.destination.endpoint ?? "",
    bucket: policy?.destination.bucket ?? "",
    region: policy?.destination.region ?? "",
    schedule: policy?.schedule ?? "",
    suspendSchedule: policy?.suspendSchedule ?? false,
    retention: policy?.retention ?? emptyRetention,
    allowTenantOverride: policy?.allowTenantOverride ?? true,
  };
}

function bodyFrom(draft: Draft, confirm?: string): BackupPolicyBody {
  return {
    destination: { endpoint: draft.endpoint.trim(), bucket: draft.bucket.trim(), region: draft.region.trim() },
    schedule: draft.schedule.trim(),
    suspendSchedule: draft.suspendSchedule,
    retention: draft.retention,
    confirm,
  };
}

const RETENTION_TIERS: { key: keyof BackupRetention; label: string; hint: string }[] = [
  { key: "keepLast", label: "Most recent", hint: "always kept, whatever their age" },
  { key: "keepDaily", label: "Daily", hint: "one per day" },
  { key: "keepWeekly", label: "Weekly", hint: "one per week" },
  { key: "keepMonthly", label: "Monthly", hint: "one per month" },
  { key: "keepYearly", label: "Yearly", hint: "one per year" },
];

function RetentionFields({
  value,
  onChange,
}: {
  value: BackupRetention;
  onChange: (next: BackupRetention) => void;
}) {
  return (
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
  );
}

function DestinationFields({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <div className="admin-console__stack">
      <label className="admin-console__label">
        <span className="admin-console__label-text">Endpoint</span>
        <input
          placeholder="https://sos-ch-gva-2.exo.io — leave empty for the platform's own storage"
          value={draft.endpoint}
          onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
        />
      </label>
      <label className="admin-console__label">
        <span className="admin-console__label-text">Bucket</span>
        <input
          placeholder="leave empty to keep the default name"
          value={draft.bucket}
          onChange={(e) => setDraft({ ...draft, bucket: e.target.value })}
        />
      </label>
      <label className="admin-console__label">
        <span className="admin-console__label-text">Region</span>
        <input
          placeholder="required by some providers; MinIO needs none"
          value={draft.region}
          onChange={(e) => setDraft({ ...draft, region: e.target.value })}
        />
      </label>
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
      </p>
      {policy.credentialRequirement && !policy.credentialSatisfied && (
        <p className="admin-console__warning">
          Waiting for storage keys. Supply <code>{policy.credentialRequirement}</code> in the
          Credentials tab — until then, backups to this destination cannot run.
        </p>
      )}
      {policy.message && <p className="admin-console__hint">{policy.message}</p>}
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

  useEffect(() => {
    if (clusterQuery.data) setClusterDraft(draftFrom(clusterQuery.data));
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
    onSuccess: settled("Workspace backup settings saved."),
    onError: failed,
  });
  const reset = useMutation({
    mutationFn: () => resetBackupPolicy(tenant),
    onSuccess: settled("Back to the cluster default."),
    onError: failed,
  });

  const clusterPolicy = clusterQuery.data;
  const tenantPolicy = tenantQuery.data;
  const movingStorage = tenantDraft.endpoint.trim() !== "";
  const overrideBlocked = clusterPolicy ? !clusterPolicy.allowTenantOverride : false;

  return (
    <section className="admin-console__section">
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">Backup policy</h2>
          <p className="admin-console__lead">
            Where backups are stored, how often they run, and how long they are kept.
          </p>
        </div>
      </header>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      {isPlatformAdmin && (
        <div className="admin-console__subsection">
          <h3 className="admin-console__subsection-title">Cluster default</h3>
          <p className="admin-console__hint">
            Applies to every workspace that does not set its own.
          </p>

          <DestinationFields draft={clusterDraft} setDraft={setClusterDraft} />

          <label className="admin-console__label">
            <span className="admin-console__label-text">Schedule (UTC)</span>
            <input
                placeholder="0 3 * * * — leave empty for no scheduled backups"
              value={clusterDraft.schedule}
              onChange={(e) => setClusterDraft({ ...clusterDraft, schedule: e.target.value })}
            />
          </label>

          <h4 className="admin-console__label-text">Keep</h4>
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
              Let workspaces use their own storage. Turning this off keeps every bundle where
              you can reach it.
            </span>
          </label>

          <div className="admin-console__submit">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={saveCluster.isPending}
              onClick={() => saveCluster.mutate()}
            >
              {saveCluster.isPending ? "Saving…" : "Save cluster default"}
            </button>
          </div>

          {clusterPolicy && <EffectiveSummary policy={clusterPolicy} />}
        </div>
      )}

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">This workspace</h3>

        {tenantPolicy && !tenantPolicy.configured && !overriding && (
          <p className="admin-console__hint">
            Using the cluster default. <EffectiveInline policy={tenantPolicy} />
          </p>
        )}

        {overrideBlocked && !overriding ? (
          <p className="admin-console__hint">
            Your provider has fixed the backup destination for all workspaces on this cluster.
          </p>
        ) : (
          <>
            {!overriding && (
              <button
                type="button"
                className="admin-console__btn"
                onClick={() => setOverriding(true)}
              >
                Change for this workspace
              </button>
            )}

            {overriding && (
              <>
                <label className="admin-console__label">
                  <span className="admin-console__label-text">Schedule (UTC)</span>
                  <input
                            placeholder="leave empty to inherit"
                    value={tenantDraft.schedule}
                    onChange={(e) => setTenantDraft({ ...tenantDraft, schedule: e.target.value })}
                  />
                </label>
                <label className="admin-console__checkbox">
                  <input
                    type="checkbox"
                    checked={tenantDraft.suspendSchedule}
                    onChange={(e) =>
                      setTenantDraft({ ...tenantDraft, suspendSchedule: e.target.checked })
                    }
                  />
                  <span>No scheduled backups for this workspace</span>
                </label>

                <h4 className="admin-console__label-text">Keep</h4>
                <RetentionFields
                  value={tenantDraft.retention}
                  onChange={(retention) => setTenantDraft({ ...tenantDraft, retention })}
                />

                <h4 className="admin-console__label-text">Your own storage</h4>
                <DestinationFields draft={tenantDraft} setDraft={setTenantDraft} />

                {movingStorage && (
                  <div className="admin-console__warning">
                    <p>
                      Backups will be written to your storage instead of the platform&apos;s.
                      Recovering then starts by fetching a bundle from there, so it depends on
                      that endpoint being reachable and on the keys staying valid — if either
                      lapses, the backups are unusable until it is fixed.
                    </p>
                    <p>
                      Bundles already written stay where they are and remain restorable.
                    </p>
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
                      saveTenant.isPending || (movingStorage && confirmName.trim() !== tenant)
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
                        if (window.confirm("Go back to the cluster default?")) reset.mutate();
                      }}
                    >
                      Use the cluster default
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {tenantPolicy && <EffectiveSummary policy={tenantPolicy} />}
      </div>
    </section>
  );
}

function EffectiveInline({ policy }: { policy: BackupPolicy }) {
  return (
    <>
      Backups go to <code>{policy.effectiveBucket || "the platform's storage"}</code>
      {policy.effectiveSchedule ? `, ${policy.effectiveSchedule} UTC.` : ", on request only."}
    </>
  );
}
