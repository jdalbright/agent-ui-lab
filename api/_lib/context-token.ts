import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { LIMITS } from "../../shared/constants.js";

const TurnSummarySchema = z
  .object({
    intent: z.enum(["weather", "comparison", "research", "narrative", "location"]),
    summary: z.string().trim().min(1).max(240),
    entities: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
  })
  .strict();

const ContextPayloadSchema = z
  .object({
    version: z.literal(1),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    turns: z.array(TurnSummarySchema).max(LIMITS.contextTurns),
  })
  .strict();

export type TurnSummary = z.infer<typeof TurnSummarySchema>;
export type ContextPayload = z.infer<typeof ContextPayloadSchema>;

export class ContextTokenError extends Error {
  readonly code: "invalid" | "expired" | "unconfigured";

  constructor(code: ContextTokenError["code"]) {
    super(`Context token ${code}`);
    this.name = "ContextTokenError";
    this.code = code;
  }
}

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new ContextTokenError("unconfigured");
  return createHash("sha256").update(secret, "utf8").digest();
}

function sanitizeSummaryText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, "[coordinates]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function sanitizeTurnSummary(input: TurnSummary): TurnSummary {
  return TurnSummarySchema.parse({
    intent: input.intent,
    summary: sanitizeSummaryText(input.summary),
    entities: input.entities.map(sanitizeSummaryText).filter(Boolean).slice(0, 4),
  });
}

export function createContextToken(
  secret: string,
  turns: TurnSummary[],
  now = Date.now(),
): { token: string; expiresAt: string } {
  const key = keyFromSecret(secret);
  const iv = randomBytes(12);
  const expiresAt = now + LIMITS.contextTtlMs;
  const payload = ContextPayloadSchema.parse({
    version: 1,
    issuedAt: now,
    expiresAt,
    turns: turns.slice(-LIMITS.contextTurns).map(sanitizeTurnSummary),
  });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("agent-ui-lab/context/v1", "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    token: `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function readContextToken(secret: string, token: string, now = Date.now()): ContextPayload {
  const key = keyFromSecret(secret);
  const [version, ivEncoded, ciphertextEncoded, tagEncoded, ...extra] = token.split(".");
  if (version !== "v1" || !ivEncoded || !ciphertextEncoded || !tagEncoded || extra.length > 0) {
    throw new ContextTokenError("invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAAD(Buffer.from("agent-ui-lab/context/v1", "utf8"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = ContextPayloadSchema.parse(JSON.parse(plaintext) as unknown);
    if (payload.expiresAt <= now) throw new ContextTokenError("expired");
    return payload;
  } catch (error) {
    if (error instanceof ContextTokenError) throw error;
    throw new ContextTokenError("invalid");
  }
}
