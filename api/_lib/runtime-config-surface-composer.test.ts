import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./runtime-config.js";

describe("surface composer runtime contract", () => {
  it("defaults to the rollback-safe spec-v1 composer", () => {
    const result = readRuntimeConfig({ NODE_ENV: "test" });

    expect(result.ready).toBe(true);
    if (!result.ready) return;
    const config = result.config as typeof result.config & {
      surfaceComposerVersion?: string;
    };
    expect(config.surfaceComposerVersion).toBe("spec-v1");
  });

  it.each(["spec-v1", "plan-v2"] as const)(
    "accepts the supported %s composer version",
    (surfaceComposerVersion) => {
      const result = readRuntimeConfig({
        NODE_ENV: "test",
        SURFACE_COMPOSER_VERSION: surfaceComposerVersion,
      });

      expect(result.ready).toBe(true);
      if (!result.ready) return;
      const config = result.config as typeof result.config & {
        surfaceComposerVersion?: string;
      };
      expect(config.surfaceComposerVersion).toBe(surfaceComposerVersion);
    },
  );

  it("rejects an invalid version with a stable issue code and never echoes its value", () => {
    const privateValue = "plan-v2-private-token-value";
    const result = readRuntimeConfig({
      NODE_ENV: "test",
      SURFACE_COMPOSER_VERSION: privateValue,
    });

    expect(result).toEqual({
      ready: false,
      issues: ["SURFACE_COMPOSER_VERSION_INVALID"],
    });
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });
});
