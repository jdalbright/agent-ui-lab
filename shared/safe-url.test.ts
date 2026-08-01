import { describe, expect, it } from "vitest";
import { SourceRecordSchema } from "./schemas.js";
import {
  canonicalizeSafeExternalHttpsUrl,
  isSafeExternalHttpsUrl,
  isUnsafeSourceUrl,
} from "./safe-url.js";

const source = {
  id: "src_secure01",
  title: "Trusted source",
  provider: "google-search" as const,
  accessedAt: "2026-08-01T12:00:00.000Z",
};

describe("production source URL policy", () => {
  it.each([
    "https://example.com/research?q=weather",
    "https://subdomain.example.org:8443/path",
    "https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/javascript",
  ])("accepts a public HTTPS URL: %s", (url) => {
    expect(isSafeExternalHttpsUrl(url)).toBe(true);
    expect(isUnsafeSourceUrl(url)).toBe(false);
    expect(SourceRecordSchema.safeParse({ ...source, url }).success).toBe(true);
  });

  it.each([
    "http://example.com/insecure",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
    "https://localhost/internal",
    "https://api.localhost/internal",
    "https://0.0.0.0/internal",
    "https://10.24.0.1/internal",
    "https://100.64.0.1/internal",
    "https://127.0.0.1/internal",
    "https://169.254.169.254/latest/meta-data",
    "https://172.16.0.1/internal",
    "https://192.168.1.1/internal",
    "https://198.18.0.1/internal",
    "https://224.0.0.1/internal",
    "https://2130706433/internal",
    "https://0x7f000001/internal",
    "https://[::]/internal",
    "https://[::1]/internal",
    "https://[fc00::1]/internal",
    "https://[fd12:3456::1]/internal",
    "https://[fe80::1]/internal",
    "https://[::ffff:127.0.0.1]/internal",
    "https://[::ffff:10.0.0.1]/internal",
    "https://example.com/%6a%61%76%61%73%63%72%69%70%74%3aalert(1)",
    "https://example.com/redirect?next=data%3Atext%2Fhtml%2Cunsafe",
  ])("rejects an unsafe or non-public URL: %s", (url) => {
    expect(isSafeExternalHttpsUrl(url)).toBe(false);
    expect(isUnsafeSourceUrl(url)).toBe(true);
    expect(SourceRecordSchema.safeParse({ ...source, url }).success).toBe(false);
  });

  it("canonicalizes only safe URLs and removes fragments", () => {
    expect(canonicalizeSafeExternalHttpsUrl("https://Example.com/path#section")).toBe(
      "https://example.com/path",
    );
    expect(canonicalizeSafeExternalHttpsUrl("https://127.0.0.1/internal#section")).toBeUndefined();
  });
});
