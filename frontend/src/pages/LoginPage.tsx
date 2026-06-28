import { useNavigate } from "@tanstack/react-router";
import { defaultBasePath } from "@/lib/device";

export function LoginPage() {
  const navigate = useNavigate();

  function signIn() {
    // M2: Keycloak OIDC redirect. Dev bypass goes straight to shell.
    void navigate({ to: defaultBasePath() });
  }

  return (
    <div className="gentian-shell flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-[var(--gtn-r2)] border border-[var(--gtn-border)] bg-[var(--gtn-paper-3)] p-8 text-center shadow-[var(--gtn-shadow-3)]">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--gtn-500)]">
          Gentian
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-[var(--gtn-ink-1)]/70">
          Sign in to your workspace
        </p>
        <button
          type="button"
          onClick={signIn}
          className="mt-8 w-full rounded-[var(--gtn-r2)] bg-[var(--gtn-500)] px-4 py-3 text-white hover:bg-[var(--gtn-600)]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
