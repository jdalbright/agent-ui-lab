import type { Interactions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import searchFixture from "../_fixtures/gemini-search-grounding.json" with { type: "json" };
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import {
  createGeminiProvider,
  GeminiProviderError,
  GeminiToolRoundLimitError,
  type GeminiClient,
  type GeminiInteraction,
  normalizeGoogleSearchSources,
  runGeminiRetrieval,
} from "./gemini.js";

const clientContext: ClientContext = {
  sizeClass: "medium",
  locale: "en-US",
  timeZone: "America/New_York",
  units: "imperial",
  reducedMotion: false,
};

function fakeClient(responses: GeminiInteraction[]) {
  const requests: Interactions.CreateModelInteractionParamsNonStreaming[] = [];
  const create = vi.fn((request: Interactions.CreateModelInteractionParamsNonStreaming) => {
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error("No fake Gemini response remains");
    return Promise.resolve(response);
  });

  return {
    client: { interactions: { create } } satisfies GeminiClient,
    requests,
  };
}

function functionCallResponse(id: string, signature: string): GeminiInteraction {
  return {
    id: `interaction_${id}`,
    status: "requires_action",
    steps: [
      { type: "thought", signature },
      {
        type: "function_call",
        id,
        name: "get_weather_bundle",
        arguments: { location: "Raleigh, NC", units: "imperial" },
      },
    ],
  };
}

describe("createGeminiProvider", () => {
  it("uses the documented no-tools responseFormat request without putting the key in the URL", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ text: '{"label":"ready"}' }] } }],
          }),
      } as Response),
    ) as unknown as typeof fetch;
    const provider = createGeminiProvider({ apiKey: "unit-test-key", fetchImpl });

    const output = await provider.structuredOutput?.generate({
      input: "Return a short label.",
      systemInstruction: "Return only the requested JSON.",
      schema: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
    });

    expect(output).toEqual({ text: '{"label":"ready"}' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(typeof url).toBe("string");
    if (typeof url !== "string") throw new TypeError("Expected a string provider URL.");
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
    expect(url).not.toContain("unit-test-key");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("unit-test-key");
    expect(typeof init?.body).toBe("string");
    if (typeof init?.body !== "string") throw new TypeError("Expected a JSON request body.");
    expect(JSON.parse(init.body) as unknown).toEqual({
      contents: [{ role: "user", parts: [{ text: "Return a short label." }] }],
      systemInstruction: { parts: [{ text: "Return only the requested JSON." }] },
      generationConfig: {
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: {
              type: "object",
              properties: { label: { type: "string" } },
              required: ["label"],
              additionalProperties: false,
            },
          },
        },
      },
    });
  });
});

describe("runGeminiRetrieval", () => {
  it("replays every signed step unchanged before the matching function result", async () => {
    const first = functionCallResponse("weather_1", "signed-thought-1");
    const final = searchFixture as GeminiInteraction;
    const { client, requests } = fakeClient([first, final]);
    const weatherSource: SourceRecord = {
      id: "src_weather01",
      title: "Google Weather for Raleigh",
      url: "https://weather.googleapis.com/v1/currentConditions:lookup",
      provider: "google-weather",
      accessedAt: "2026-08-01T16:00:00.000Z",
    };
    const executeWeather = vi.fn(() =>
      Promise.resolve({
        data: { current: { temperature: 88, unit: "F" } },
        sources: [weatherSource],
      }),
    );

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "Will it rain in Raleigh today, and what should I bring?",
      clientContext,
      executeWeather,
      now: () => new Date("2026-08-01T16:00:00.000Z"),
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      model: "gemini-3.6-flash",
      store: false,
    });
    expect(requests[0]?.previous_interaction_id).toBeUndefined();
    expect(requests[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "get_weather_bundle" }),
        expect.objectContaining({ type: "google_search" }),
      ]),
    );

    const replay = requests[1]?.input as Interactions.Step[];
    expect(replay[1]).toBe(first.steps[0]);
    expect(replay[2]).toBe(first.steps[1]);
    expect(replay[3]).toEqual({
      type: "function_result",
      name: "get_weather_bundle",
      call_id: "weather_1",
      result: [
        {
          type: "text",
          text: JSON.stringify({ current: { temperature: 88, unit: "F" } }),
        },
      ],
    });
    expect(requests[1]?.tools).toEqual(requests[0]?.tools);
    expect(executeWeather).toHaveBeenCalledWith({
      location: "Raleigh, NC",
      units: "imperial",
    });
    expect(result.outputText).toBe(searchFixture.output_text);
    expect(result.toolRounds).toBe(1);
    expect(result.sources.map((source) => source.provider)).toEqual([
      "google-weather",
      "google-search",
    ]);
  });

  it("normalizes, deduplicates, validates, and freezes Google Search citations", async () => {
    const { client } = fakeClient([searchFixture as GeminiInteraction]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "Is Gemini 3.6 Flash production ready?",
      clientContext,
      executeWeather: vi.fn(),
      now: () => new Date("2026-08-01T12:34:56.000Z"),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.id).toMatch(/^src_[a-f0-9]{16}$/);
    expect(result.sources[0]).toMatchObject({
      title: "Gemini 3.6 Flash",
      url: "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
      provider: "google-search",
      accessedAt: "2026-08-01T12:34:56.000Z",
      snippet: searchFixture.output_text,
    });
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(Object.isFrozen(result.sources[0])).toBe(true);
  });

  it("drops unsafe HTTPS citations before SourceRecord construction", () => {
    const steps = [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text: "Public evidence with unsafe redirect targets.",
            annotations: [
              { type: "url_citation", url: "https://example.com/public", title: "Public" },
              { type: "url_citation", url: "https://user:pass@example.com/private", title: "Credentials" },
              { type: "url_citation", url: "https://127.0.0.1/internal", title: "Loopback" },
              { type: "url_citation", url: "https://[::ffff:10.0.0.1]/internal", title: "Mapped private" },
            ],
          },
        ],
      },
    ] as Interactions.Step[];

    expect(normalizeGoogleSearchSources(steps, new Date("2026-08-01T12:00:00.000Z"))).toEqual([
      expect.objectContaining({ url: "https://example.com/public" }),
    ]);
  });

  it("executes at most two custom-tool rounds", async () => {
    const responses = [
      functionCallResponse("weather_1", "signed-thought-1"),
      functionCallResponse("weather_2", "signed-thought-2"),
      functionCallResponse("weather_3", "signed-thought-3"),
    ];
    const { client, requests } = fakeClient(responses);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Compare today's weather in Raleigh with this evening.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toBeInstanceOf(GeminiToolRoundLimitError);

    expect(requests).toHaveLength(3);
    expect(executeWeather).toHaveBeenCalledTimes(2);
  });

  it("rejects a failed provider interaction instead of returning empty evidence", async () => {
    const { client } = fakeClient([
      {
        id: "interaction_failed",
        status: "failed",
        steps: [],
      },
    ]);

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Research current conditions.",
        clientContext,
        executeWeather: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(GeminiProviderError);
  });
});
