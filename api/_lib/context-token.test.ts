import { describe, expect, it } from "vitest";
import { LIMITS } from "../../shared/constants.js";
import {
  createContextToken,
  readContextToken,
  sanitizeTurnSummary,
  type ContextTokenError,
  type TurnSummary,
} from "./context-token.js";

const secret = "context-test-secret-that-is-at-least-32-characters";
const now = Date.parse("2026-08-01T12:00:00.000Z");

function turn(summary: string, intent: TurnSummary["intent"] = "research"): TurnSummary {
  return { intent, summary, entities: [] };
}

describe("context tokens", () => {
  it("round-trips an authenticated payload with a 30-minute expiry", () => {
    const created = createContextToken(secret, [turn("Compare two trusted options", "comparison")], now);
    const payload = readContextToken(secret, created.token, now + 1);

    expect(created.token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(created.expiresAt).toBe(new Date(now + LIMITS.contextTtlMs).toISOString());
    expect(payload).toEqual({
      version: 1,
      issuedAt: now,
      expiresAt: now + LIMITS.contextTtlMs,
      turns: [{ intent: "comparison", summary: "Compare two trusted options", entities: [] }],
    });
  });

  it("keeps only the three newest compact turns", () => {
    const turns = [
      turn("first", "narrative"),
      turn("second", "weather"),
      turn("third", "comparison"),
      turn("fourth", "research"),
    ];

    const payload = readContextToken(secret, createContextToken(secret, turns, now).token, now);

    expect(payload.turns.map((item) => item.summary)).toEqual(["second", "third", "fourth"]);
  });

  it("removes direct identifiers, secrets, coordinates, and control characters", () => {
    const sanitized = sanitizeTurnSummary({
      intent: "weather",
      summary:
        "Email jacob@example.com\nCall (919) 555-1212 api_key:supersecret near 35.7796, -78.6382",
      entities: [
        "jacob@example.com",
        "token=private-value",
        "35.7796,-78.6382",
        "Raleigh\u0000NC",
        "discarded fifth entity",
      ],
    });

    expect(sanitized.summary).toContain("[email]");
    expect(sanitized.summary).toContain("[phone]");
    expect(sanitized.summary).toContain("api_key=[redacted]");
    expect(sanitized.summary).toContain("[coordinates]");
    expect(sanitized.summary).not.toMatch(/jacob|555-1212|supersecret|35\.7796/);
    expect(sanitized.entities).toEqual([
      "[email]",
      "token=[redacted]",
      "[coordinates]",
      "Raleigh NC",
    ]);
  });

  it("rejects a token at or after its expiration time", () => {
    const { token } = createContextToken(secret, [turn("short-lived context")], now);

    expect(() => readContextToken(secret, token, now + LIMITS.contextTtlMs)).toThrowError(
      expect.objectContaining<Partial<ContextTokenError>>({ code: "expired" }),
    );
  });

  it("rejects tampering and a token read with the wrong secret", () => {
    const { token } = createContextToken(secret, [turn("authenticated context")], now);
    const parts = token.split(".");
    const ciphertext = parts[2];
    parts[2] = `${ciphertext[0] === "a" ? "b" : "a"}${ciphertext.slice(1)}`;

    for (const candidate of [
      () => readContextToken(secret, parts.join("."), now),
      () => readContextToken("different-secret-that-is-also-long-enough", token, now),
      () => readContextToken(secret, `${token}.extra`, now),
    ]) {
      expect(candidate).toThrowError(
        expect.objectContaining<Partial<ContextTokenError>>({ code: "invalid" }),
      );
    }
  });

  it("requires a suitably long server secret", () => {
    expect(() => createContextToken("too-short", [turn("context")], now)).toThrowError(
      expect.objectContaining<Partial<ContextTokenError>>({ code: "unconfigured" }),
    );
  });
});
