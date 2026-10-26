import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { CredentialStatus } from "@/api/credentials";
import {
  CredentialsSection,
  credentialsRefetchInterval,
  PENDING_FAST_WINDOW_MS,
  PENDING_POLL_FAST_MS,
  PENDING_POLL_SLOW_MS,
} from "./CredentialsSection";

// The custodian's Status as it serves it (gentian-os internal/custodian
// catalogue.go): pending is set for a value stored moments ago that the
// secret store's sync has not confirmed yet.
function credential(over: Partial<CredentialStatus>): CredentialStatus {
  return {
    name: "smtp-relay",
    displayName: "SMTP relay",
    phase: "runtime",
    scope: "cluster",
    optional: false,
    vaultPath: "gentian-os/kernel/mail/postfix",
    fields: [{ key: "relay_password", secret: true }],
    satisfied: false,
    ...over,
  };
}

function render(credentials: CredentialStatus[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "credentials"], credentials);
  client.setQueryData(["admin", "repositories"], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <CredentialsSection />
    </QueryClientProvider>,
  );
}

describe("CredentialsSection", () => {
  it("shows a value just stored as being checked, not missing", async () => {
    await i18n.changeLanguage("en");
    const html = render([
      credential({ pending: true, reason: "saved, being checked" }),
    ]);
    expect(html).toContain("Saved, being checked");
    expect(html).not.toContain(">missing<");
    // Not counted among the credentials still to supply, and not flagged.
    expect(html).not.toContain("not yet supplied");
    expect(html).not.toContain("admin-console__card--attention");
  });

  it("says it in German", async () => {
    await i18n.changeLanguage("de");
    expect(render([credential({ pending: true })])).toContain("Gespeichert, wird geprüft");
    await i18n.changeLanguage("en");
  });

  it("still reports a value the store has not got as missing", async () => {
    await i18n.changeLanguage("en");
    const html = render([credential({ reason: "SecretSyncedError" })]);
    expect(html).toContain(">missing<");
    expect(html).toContain("SecretSyncedError");
  });
});

describe("credentialsRefetchInterval", () => {
  const now = 1_000_000;
  const pending = [credential({ pending: true })];

  it("does not poll when nothing is pending", () => {
    expect(credentialsRefetchInterval([credential({ satisfied: true })], now, now)).toBe(false);
    expect(credentialsRefetchInterval(undefined, now, now)).toBe(false);
  });

  it("polls fast for a minute after a save, then slowly until confirmed", () => {
    expect(credentialsRefetchInterval(pending, now - 1_000, now)).toBe(PENDING_POLL_FAST_MS);
    expect(credentialsRefetchInterval(pending, now - PENDING_FAST_WINDOW_MS, now)).toBe(
      PENDING_POLL_SLOW_MS,
    );
    expect(credentialsRefetchInterval(pending, null, now)).toBe(PENDING_POLL_SLOW_MS);
  });
});
