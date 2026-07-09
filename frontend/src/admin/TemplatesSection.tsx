import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMembers } from "@/api/admin";
import {
  applyTemplate,
  createTemplate,
  deleteTemplate,
  fetchTemplates,
} from "@/api/prefs";
import "./admin.css";

type TemplatesSectionProps = {
  tenant: string;
};

export function TemplatesSection({ tenant }: TemplatesSectionProps) {
  const queryClient = useQueryClient();
  const [templateName, setTemplateName] = useState("");
  const [sourceUserSub, setSourceUserSub] = useState("");
  const [applyTargetUserSub, setApplyTargetUserSub] = useState("");
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch tenant members
  const membersQuery = useQuery({
    queryKey: ["admin", "members", tenant],
    queryFn: () => fetchMembers(tenant),
  });
  const members = membersQuery.data ?? [];

  // Fetch settings templates
  const templatesQuery = useQuery({
    queryKey: ["admin", "templates", tenant],
    queryFn: () => fetchTemplates(),
  });
  const templates = templatesQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: () => createTemplate(templateName.trim(), sourceUserSub),
    onSuccess: async () => {
      setTemplateName("");
      setSourceUserSub("");
      setError(null);
      setSuccess("Settings template created successfully.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "templates", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: async () => {
      setError(null);
      setSuccess("Settings template deleted.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "templates", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!applyingTemplateId) throw new Error("No template selected");
      return applyTemplate(applyingTemplateId, applyTargetUserSub);
    },
    onSuccess: async () => {
      setApplyingTemplateId(null);
      setApplyTargetUserSub("");
      setError(null);
      setSuccess("Settings template applied to member successfully.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) {
      setError("Please specify a template name.");
      return;
    }
    if (!sourceUserSub) {
      setError("Please select a user to copy settings from.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Settings Templates
        </h2>
      </div>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      {/* Save Settings Template Form */}
      <div className="admin-console__edit-panel" style={{ marginBottom: "1.5rem" }}>
        <div className="admin-console__edit-panel-header">
          <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Save User Settings as Template</div>
        </div>
        <form className="admin-console__edit-panel-body" onSubmit={handleCreateTemplate}>
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label">Template name</div>
            <div className="admin-console__edit-row-value">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Backoffice Profile"
                style={{ width: "100%", maxWidth: "20rem" }}
              />
            </div>
          </div>
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label">Source user</div>
            <div className="admin-console__edit-row-value">
              <select
                value={sourceUserSub}
                onChange={(e) => setSourceUserSub(e.target.value)}
                style={{ width: "100%", maxWidth: "20rem" }}
              >
                <option value="">-- Select member to copy settings from --</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email ?? m.username} ({[m.firstName, m.lastName].filter(Boolean).join(" ") || "No Name"})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label" />
            <div className="admin-console__edit-row-value">
              <button
                type="submit"
                className="admin-console__btn admin-console__btn--primary"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Manual Apply Template Modal-like Row */}
      {applyingTemplateId && (
        <div className="admin-console__edit-panel" style={{ marginBottom: "1.5rem", borderLeftColor: "var(--gtn-accent)" }}>
          <div className="admin-console__edit-panel-header">
            <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Apply Template to Member</div>
            <button type="button" className="admin-console__btn" onClick={() => setApplyingTemplateId(null)}>
              ✕ Cancel
            </button>
          </div>
          <div className="admin-console__edit-panel-body">
            <div className="admin-console__edit-row">
              <div className="admin-console__edit-row-label">Target member</div>
              <div className="admin-console__edit-row-value" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select
                  value={applyTargetUserSub}
                  onChange={(e) => setApplyTargetUserSub(e.target.value)}
                  style={{ flex: "1", maxWidth: "20rem" }}
                >
                  <option value="">-- Select member to apply template --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.email ?? m.username}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--primary"
                  onClick={() => applyMutation.mutate()}
                  disabled={!applyTargetUserSub || applyMutation.isPending}
                >
                  {applyMutation.isPending ? "Applying…" : "Apply Template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Templates List */}
      <table className="admin-console__table">
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Wallpaper</th>
            <th>Shortcuts Count</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "var(--gtn-ink-4)", padding: "2rem" }}>
                No settings templates created yet. Use the form above to save a member's desktop as a template.
              </td>
            </tr>
          ) : (
            templates.map((tpl) => {
              const shortcuts = tpl.prefs_json?.desktopTiles?.length ?? 0;
              const menuPins = tpl.prefs_json?.menuAppIds?.length ?? "Default";
              return (
                <tr key={tpl.id}>
                  <td className="admin-console__mono" style={{ fontWeight: 600 }}>{tpl.name}</td>
                  <td>{tpl.hasBackground ? "Custom Image" : "Default"}</td>
                  <td>
                    {shortcuts} desktop tile{shortcuts === 1 ? "" : "s"} ({menuPins} menu pins)
                  </td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button
                      type="button"
                      className="admin-console__btn"
                      style={{ marginRight: "0.5rem" }}
                      onClick={() => {
                        setApplyingTemplateId(tpl.id);
                        setApplyTargetUserSub("");
                      }}
                    >
                      Apply to Member
                    </button>
                    <button
                      type="button"
                      className="admin-console__btn admin-console__btn--danger"
                      onClick={() => {
                        if (window.confirm(`Delete settings template "${tpl.name}"?`)) {
                          deleteMutation.mutate(tpl.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
