import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { ReleaseView } from "@/api/cluster";
import { RELEASE_QUERY_KEY, ReleaseSection } from "./ReleaseSection";

function render(view: ReleaseView) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(RELEASE_QUERY_KEY, view);
  return renderToString(
    <QueryClientProvider client={client}>
      <ReleaseSection />
    </QueryClientProvider>,
  );
}

describe("ReleaseSection", () => {
  it("shows the release the claim declares, what was applied and what waits for a person", () => {
    const html = render({
      cluster: "demo",
      spec: { version: "v0.5.1", autoUpgrade: "patch" },
      status: { state: "Applied", message: "release v0.5.1", revision: "v0.5.1", image: "0.5.1", pending: "v0.6.0", pendingNotes: "https://example.org/v0.6.0" },
      platform: { version: "0.5.1", build: "0.5.1" },
      window: { start: "02:00", end: "05:00", timezone: "Europe/Zurich" },
      windowOpen: false,
    });
    expect(html).toContain("v0.5.1");
    expect(html).toContain("Applied: release v0.5.1");
    expect(html).toContain("02:00–05:00 Europe/Zurich");
    expect(html).toContain("v0.6.0");
    expect(html).toContain("Take v0.6.0");
    expect(html).toContain("https://example.org/v0.6.0");
  });

  it("says when nothing is declared and offers to set a release", () => {
    const html = render({ cluster: "demo", spec: {}, windowOpen: true });
    expect(html).toContain("declares no release");
    expect(html).not.toContain("Take ");
    expect(html).toContain("Follow branch");
  });

  it("shows a track as a branch the cluster follows", () => {
    const html = render({
      cluster: "demo",
      spec: { track: "develop" },
      status: { state: "Pending", message: "branch develop is at abc1234, whose build is not published yet" },
      windowOpen: true,
    });
    expect(html).toContain("Follows branch develop");
    expect(html).toContain("Pending: branch develop");
  });
});
