import { describe, expect, it } from "vitest";
import { selectSurfaceComposer, surfaceGrammarRolloutBucket } from "./surface-composer-routing.js";

describe("selectSurfaceComposer", () => {
  it.each(["weather", "comparison", "research"] as const)(
    "uses plan-v2 for the supported %s domain when enabled",
    (kind) => {
      expect(selectSurfaceComposer("plan-v2", kind)).toBe("plan-v2");
    },
  );

  it.each(["weather", "comparison", "research"] as const)(
    "uses grammar-v3 for the supported %s domain when enabled",
    (kind) => {
      expect(selectSurfaceComposer("grammar-v3", kind)).toBe("grammar-v3");
    },
  );

  it.each(["narrative", "location"] as const)(
    "keeps unsupported %s surfaces on spec-v1 when grammar-v3 is enabled",
    (kind) => {
      expect(selectSurfaceComposer("grammar-v3", kind)).toBe("spec-v1");
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

  it("uses a stable bounded rollout bucket", () => {
    expect(surfaceGrammarRolloutBucket("stable-request-key")).toBe(
      surfaceGrammarRolloutBucket("stable-request-key"),
    );
    expect(surfaceGrammarRolloutBucket("stable-request-key")).toBeGreaterThanOrEqual(0);
    expect(surfaceGrammarRolloutBucket("stable-request-key")).toBeLessThan(100);
  });

  it("routes grammar-v3 exposure deterministically and otherwise preserves plan-v2", () => {
    expect(selectSurfaceComposer("grammar-v3", "research", "key", 0)).toBe("plan-v2");
    expect(selectSurfaceComposer("grammar-v3", "research", "key", 100)).toBe("grammar-v3");
    const bucket = surfaceGrammarRolloutBucket("key");
    expect(selectSurfaceComposer("grammar-v3", "research", "key", bucket)).toBe("plan-v2");
    expect(selectSurfaceComposer("grammar-v3", "research", "key", bucket + 1)).toBe("grammar-v3");
  });
});
