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

  it.each(["spec-v1", "plan-v2", "grammar-v3"] as const)(
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

  it.each([0, 10, 50, 100])("accepts a bounded grammar-v3 rollout percentage of %i", (percent) => {
    const result = readRuntimeConfig({
      NODE_ENV: "test",
      SURFACE_COMPOSER_VERSION: "grammar-v3",
      SURFACE_GRAMMAR_V3_ROLLOUT_PERCENT: String(percent),
    });

    expect(result).toMatchObject({
      ready: true,
      config: { surfaceGrammarV3RolloutPercent: percent },
    });
  });

  it.each(["-1", "101", "10.5", "many"])(
    "rejects invalid grammar-v3 rollout percentage %s without echoing it",
    (percent) => {
      const result = readRuntimeConfig({
        NODE_ENV: "test",
        SURFACE_COMPOSER_VERSION: "grammar-v3",
        SURFACE_GRAMMAR_V3_ROLLOUT_PERCENT: percent,
      });

      expect(result).toEqual({ ready: false, issues: ["SURFACE_GRAMMAR_V3_ROLLOUT_INVALID"] });
      expect(JSON.stringify(result)).not.toContain(percent);
    },
  );

  it("defaults the grammar-v3 toolkit to the base vocabulary", () => {
    expect(readRuntimeConfig({ NODE_ENV: "test" })).toMatchObject({
      ready: true,
      config: { surfaceGrammarV3Toolkit: "base" },
    });
  });

  it.each(["base", "extended"] as const)("accepts the %s grammar-v3 toolkit", (toolkit) => {
    expect(
      readRuntimeConfig({ NODE_ENV: "test", SURFACE_GRAMMAR_V3_TOOLKIT: toolkit }),
    ).toMatchObject({ ready: true, config: { surfaceGrammarV3Toolkit: toolkit } });
  });

  it("rejects an unknown toolkit without echoing it", () => {
    const privateValue = "extended-private-value";
    const result = readRuntimeConfig({ NODE_ENV: "test", SURFACE_GRAMMAR_V3_TOOLKIT: privateValue });
    expect(result).toEqual({ ready: false, issues: ["SURFACE_GRAMMAR_V3_TOOLKIT_INVALID"] });
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });
});
