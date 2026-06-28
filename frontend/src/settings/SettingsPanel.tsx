export function SettingsPanel() {
  return (
    <section className="mx-auto max-w-lg rounded-[var(--gtn-r2)] border border-[var(--gtn-border)] bg-white p-6 shadow-[var(--gtn-shadow-3)]">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-[var(--gtn-ink-1)]/70">
        Shell preferences (wallpaper, theme, base) will be wired to{" "}
        <code className="font-mono text-xs">/api/v1/prefs</code> in M3.
      </p>
    </section>
  );
}
