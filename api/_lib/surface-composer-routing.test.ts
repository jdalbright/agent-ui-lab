import { describe, expect, it } from "vitest";
import { selectSurfaceComposer } from "./surface-composer-routing.js";

describe("selectSurfaceComposer", () => {
  it.each(["weather", "comparison", "research"] as const)(
    "uses plan-v2 for the supported %s domain when enabled",
    (kind) => {
      expect(selectSurfaceComposer("plan-v2", kind)).toBe("plan-v2");
    },
  );

  it.each(["narrative", "location"] as const)(
    "keeps %s on the trusted v1 path",
    (kind) => {
      expect(selectSurfaceComposer("plan-v2", kind)).toBe("spec-v1");
    },
  );

  it("keeps every domain on spec-v1 while the rollback flag is selected", () => {
    for (const kind of ["weather", "comparison", "research", "narrative", "location"] as const) {
      expect(selectSurfaceComposer("spec-v1", kind)).toBe("spec-v1");
    }
  });
});
