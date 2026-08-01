import { describe, expect, it } from "vitest";
import type { ServerRequest } from "./http-types.js";
import {
  parseAgentRequest,
  requestIdentity,
  RequestValidationError,
  validateOrigin,
} from "./request-validation.js";

function validBody(prompt = "What is the weather today?") {
  return {
    requestId: "019fbdb7-373b-74a3-af1e-c098150ce1a4",
    prompt,
    client: {
      sizeClass: "expanded",
      locale: "en-US",
      timeZone: "America/New_York",
      units: "imperial",
      reducedMotion: false,
    },
  };
}

describe("validateOrigin", () => {
  it("accepts exact configured and Vercel preview origins", () => {
    expect(() =>
      validateOrigin("https://lab.example.com", {
        allowedOrigins: " https://lab.example.com, http://127.0.0.1:5173 ",
      }),
    ).not.toThrow();
    expect(() =>
      validateOrigin("https://agent-ui-lab-abc.vercel.app", {
        allowedOrigins: "https://lab.example.com",
        vercelUrl: "agent-ui-lab-abc.vercel.app",
      }),
    ).not.toThrow();
  });

  it.each([
    [undefined, "Origin header is required."],
    ["not a url", "Origin is malformed."],
    ["ftp://lab.example.com", "Origin must be exact."],
    ["https://lab.example.com/", "Origin must be exact."],
    ["https://untrusted.example.com", "Origin is not on the allowlist."],
  ])("rejects unsafe origin %s", (origin, issue) => {
    try {
      validateOrigin(origin, { allowedOrigins: "https://lab.example.com" });
      throw new Error("Expected origin validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect(error).toMatchObject({ code: "ORIGIN_REJECTED", issues: [issue] });
    }
  });
});

describe("parseAgentRequest", () => {
  it("accepts and trims a valid strict request with approved coordinates", () => {
    const request = parseAgentRequest({
      ...validBody("  Weather in Raleigh  "),
      contextToken: "x".repeat(32),
      client: {
        ...validBody().client,
        coordinates: { latitude: 35.7796, longitude: -78.6382, permission: "granted" },
      },
    });

    expect(request.prompt).toBe("Weather in Raleigh");
    expect(request.client.coordinates).toEqual({
      latitude: 35.7796,
      longitude: -78.6382,
      permission: "granted",
    });
  });

  it("accepts exactly 1,000 prompt characters and rejects 1,001", () => {
    expect(parseAgentRequest(validBody("a".repeat(1_000))).prompt).toHaveLength(1_000);

    expect(() => parseAgentRequest(validBody("a".repeat(1_001)))).toThrowError(
      expect.objectContaining<Partial<RequestValidationError>>({ code: "INVALID_REQUEST" }),
    );
  });

  it.each([
    ["empty prompt", { ...validBody(), prompt: "   " }],
    ["unknown field", { ...validBody(), promptBody: "private" }],
    [
      "coordinates without explicit permission",
      {
        ...validBody(),
        client: {
          ...validBody().client,
          coordinates: { latitude: 35.7796, longitude: -78.6382 },
        },
      },
    ],
    ["oversized context token", { ...validBody(), contextToken: "x".repeat(8_193) }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseAgentRequest(body)).toThrowError(
      expect.objectContaining<Partial<RequestValidationError>>({ code: "INVALID_REQUEST" }),
    );
  });

  it("returns only a bounded set of safe validation issue descriptions", () => {
    try {
      parseAgentRequest({});
      throw new Error("Expected request validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).issues.length).toBeLessThanOrEqual(6);
      expect((error as Error).message).toBe("The request is invalid.");
    }
  });
});

describe("requestIdentity", () => {
  function request(forwarded: string | string[] | undefined, remoteAddress?: string) {
    return {
      headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
      socket: { remoteAddress },
    } as unknown as ServerRequest;
  }

  it("uses only the first forwarded address", () => {
    expect(requestIdentity(request(" 203.0.113.10, 198.51.100.2"))).toBe("203.0.113.10");
    expect(requestIdentity(request(["203.0.113.11", "198.51.100.3"]))).toBe("203.0.113.11");
  });

  it("falls back to the socket and then an anonymous sentinel", () => {
    expect(requestIdentity(request(undefined, "127.0.0.1"))).toBe("127.0.0.1");
    expect(requestIdentity(request(undefined))).toBe("unknown");
  });
});
