import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve("api");
const deployableFunctionPattern = /\.(?:[cm]?[jt]sx?)$/u;

function deployableApiEntrypoints(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("_"))
    .flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return deployableApiEntrypoints(join(directory, entry.name), relativePath);
      }
      return entry.isFile() && deployableFunctionPattern.test(entry.name)
        ? [relativePath]
        : [];
    })
    .sort();
}

describe("Vercel API deployment boundary", () => {
  it("exposes only the supported agent and health function entrypoints", () => {
    expect(deployableApiEntrypoints(apiRoot)).toEqual(["agent.ts", "health.ts"]);
  });
});
