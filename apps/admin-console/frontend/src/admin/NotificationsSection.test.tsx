import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { audienceLabel } from "./NotificationsSection";

const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as unknown as TFunction;
const own = [{ name: "sales-manager", title: "Sales manager" }];

describe("who a published notice was for", () => {
  it("names the positions by their labels", () => {
    expect(audienceLabel({ scope: "tenant", tenant: "acme", positions: ["sales-manager", "user"] }, own, t)).toBe(
      "Sales manager, user",
    );
  });

  it("says every person when no position is named", () => {
    expect(audienceLabel({ scope: "tenant", tenant: "acme", positions: [] }, own, t)).toBe("notifications.everyPerson");
    expect(audienceLabel({ scope: "tenant", tenant: "acme" }, own, t)).toBe("notifications.everyPerson");
  });

  it("says the platform for a platform notice", () => {
    expect(audienceLabel({ scope: "platform" }, own, t)).toBe("notifications.platformAllUsers");
  });
});
