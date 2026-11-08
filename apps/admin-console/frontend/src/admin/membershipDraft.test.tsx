import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { GroupMembers } from "./GroupMembers";
import { toggleDraft, withDraft, withoutKey } from "./membershipDraft";

describe("a membership draft", () => {
  const current = new Set(["app:wiki", "app:mail"]);

  it("collects ticks instead of applying them, and shows them applied", () => {
    let draft = toggleDraft({}, current, "app:chat", true);
    draft = toggleDraft(draft, current, "app:mail", false);
    expect(draft).toEqual({ "app:chat": true, "app:mail": false });
    expect([...withDraft(current, draft)].sort()).toEqual(["app:chat", "app:wiki"]);
  });

  it("forgets a box ticked back to what it is, so there is nothing to save", () => {
    const draft = toggleDraft(toggleDraft({}, current, "app:chat", true), current, "app:chat", false);
    expect(draft).toEqual({});
  });

  it("drops a change once it went through and keeps the one that failed", () => {
    expect(withoutKey({ "app:chat": true, "app:mail": false }, "app:chat")).toEqual({ "app:mail": false });
  });
});

describe("GroupMembers", () => {
  it("ticks who is in the group and offers Save only once something changed", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["admin", "people", ""], {
      people: [
        { id: "u-ada", username: "ada", name: "Ada" },
        { id: "u-bob", username: "bob" },
      ],
    });
    client.setQueryData(["admin", "people", "group-members", "gentian:tenant:acme:app:wiki"], {
      people: [{ id: "u-ada", username: "ada" }],
    });
    const html = renderToString(
      <QueryClientProvider client={client}>
        <GroupMembers group={{ id: "g1", path: "gentian:tenant:acme:app:wiki" }} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Save");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
  });
});
