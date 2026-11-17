import type { Interactions } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import searchFixture from "../_fixtures/gemini-search-grounding.json" with { type: "json" };
import { LIMITS } from "../../shared/constants.js";
import type { ClientContext, SourceRecord } from "../../shared/schemas.js";
import {
  GeminiProviderError,
  GeminiToolRoundLimitError,
  MAX_SEARCH_EVIDENCE_SPANS,
  type GeminiClient,
  type GeminiInteraction,
  normalizeGoogleSearchSources,
  runGeminiRetrieval,
  structuredOutputFromInteraction,
} from "./gemini.js";
import { buildResearchChangeManifest } from "./research-change-manifest.js";

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

function weatherArgumentsResponse(
  id: string,
  arguments_: Record<string, unknown>,
): GeminiInteraction {
  return {
    id: `interaction_${id}`,
    status: "requires_action",
    steps: [
      {
        type: "function_call",
        id,
        name: "get_weather_bundle",
        arguments: arguments_,
      },
    ],
  };
}

function completedResponse(id: string): GeminiInteraction {
  return {
    id: `interaction_${id}`,
    status: "completed",
    output_text: "Weather evidence retrieved.",
    steps: [{ type: "model_output", content: [{ type: "text", text: "Weather evidence retrieved." }] }],
  };
}

describe("structuredOutputFromInteraction", () => {
  it("accepts exactly one declarative SurfaceSpec emission", () => {
    const interaction: GeminiInteraction = {
      id: "composition_1",
      status: "requires_action",
      steps: [
        {
          type: "function_call",
          id: "surface_1",
          name: "emit_surface_spec",
          arguments: { kind: "narrative", rootId: "root", components: [] },
        },
      ],
    };

    expect(JSON.parse(structuredOutputFromInteraction(interaction)) as unknown).toEqual({
      kind: "narrative",
      rootId: "root",
      components: [],
    });
  });

  it("rejects narrative output instead of treating it as a SurfaceSpec", () => {
    expect(() =>
      structuredOutputFromInteraction({
        id: "composition_2",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "not a surface" }] }],
      }),
    ).toThrow(GeminiProviderError);
  });
});

describe("runGeminiRetrieval", () => {
  it("instructs affirmative change-summary retrieval to emit manifest-compatible cited sentences", async () => {
    const { client, requests } = fakeClient([completedResponse("change-summary-instruction")]);

    await runGeminiRetrieval({
      gemini: client,
      prompt: "What's new in Widget 2?",
      clientContext,
      executeWeather: vi.fn(),
    });

    const instruction = requests[0]?.system_instruction;
    expect(instruction).toBeTypeOf("string");
    expect(instruction).toMatch(
      /only for an affirmative[^.]*what changed[^.]*what has changed[^.]*what's new[^.]*what is new[^.]*what's different[^.]*what is different[^.]*request/i,
    );
    expect(instruction).toMatch(
      /for that conditional change-summary format[^.]*must use google_search[^.]*without source wording/i,
    );
    expect(instruction).toMatch(
      /for that conditional change-summary format[^.]*no more than two cited sources[^.]*eight independent change predicates/i,
    );
    expect(instruction).toMatch(
      /for that conditional change-summary format[^.]*exactly one independent change predicate per cited sentence/i,
    );
    expect(instruction).toMatch(
      /for that conditional change-summary format[^.]*all cited change sentences together[^.]*at or below 500 characters/i,
    );
    expect(instruction).toMatch(
      /for that conditional change-summary format[^.]*directly cite every full change sentence/i,
    );
    expect(instruction).toMatch(/exact requested subject exactly once/i);
    expect(instruction).toMatch(/compared with <baseline>, <exact requested subject>/i);
    expect(instruction).toMatch(/concrete affirmative present-tense change predicate/i);
    expect(instruction).toMatch(/adds[^.]*removes[^.]*improves[^.]*supports[^.]*no longer/i);
    expect(instruction).toMatch(
      /no preamble, heading, background, question, uncertainty, pronoun[^.]*fragment[^.]*passive or subjectless continuation outside the listed subject-plus-predicate forms/i,
    );
    expect(instruction).toMatch(/no bullets or markdown/i);
    expect(instruction).toMatch(
      /for all other requests[^.]*do not apply these change-summary limits/i,
    );
    expect(instruction).toMatch(/use get_weather_bundle for current conditions/i);
    expect(instruction).toMatch(/use google_search for current public-web facts/i);
    expect(instruction).toMatch(/use both tools when the request needs both weather data/i);
  });

  it("passes a requested seven-day Seattle outlook to the weather executor", async () => {
    const { client, requests } = fakeClient([
      weatherArgumentsResponse("seattle", {
        locations: ["Seattle, WA"],
        hours: 24,
        days: 7,
        units: "metric",
      }),
      completedResponse("seattle-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await runGeminiRetrieval({
      gemini: client,
      prompt: "Show me Seattle's seven-day outlook in Celsius.",
      clientContext,
      executeWeather,
    });

    expect(executeWeather).toHaveBeenCalledWith({
      locations: ["Seattle, WA"],
      hours: 24,
      days: 7,
      units: "metric",
    });
    const weatherTool = (requests[0]?.tools as Array<Record<string, unknown>>).find(
      (tool) => tool.name === "get_weather_bundle",
    );
    const parameters = weatherTool?.parameters as Record<string, unknown>;
    expect(parameters.type).toBe("object");
    expect(parameters.description).toBeTypeOf("string");
    expect(parameters.description as string).toContain("exactly one");
    expect(parameters.oneOf).toBeUndefined();
    expect(JSON.stringify(parameters)).not.toContain('"not"');
    expect(JSON.stringify(parameters)).not.toContain("uniqueItems");
  });

  it("passes four named comparison locations in one bounded weather request", async () => {
    const locations = ["Raleigh, NC", "Seattle, WA", "Denver, CO", "Miami, FL"];
    const { client } = fakeClient([
      weatherArgumentsResponse("four-cities", { locations, days: 7 }),
      completedResponse("four-cities-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await runGeminiRetrieval({
      gemini: client,
      prompt: "Compare this week's weather in Raleigh, Seattle, Denver, and Miami.",
      clientContext,
      executeWeather,
    });

    expect(executeWeather).toHaveBeenCalledWith({
      locations,
      days: 7,
      units: "imperial",
    });
  });

  it("preserves the requested Denver 7 AM run window as semantic tool arguments", async () => {
    const { client } = fakeClient([
      weatherArgumentsResponse("denver-run", {
        locations: ["Denver, CO"],
        hours: 48,
        days: 2,
        units: "imperial",
        activity: "run",
        durationHours: 1,
        targetLocalTime: "07:00",
        targetDayOffset: 1,
      }),
      completedResponse("denver-run-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await runGeminiRetrieval({
      gemini: client,
      prompt: "Is 7 AM tomorrow a good time for a one-hour run in Denver?",
      clientContext,
      executeWeather,
    });

    expect(executeWeather).toHaveBeenCalledWith({
      locations: ["Denver, CO"],
      hours: 48,
      days: 2,
      units: "imperial",
      activity: "run",
      durationHours: 1,
      targetLocalTime: "07:00",
      targetDayOffset: 1,
    });
  });

  it("caps aggregate weather locations across multiple function calls", async () => {
    const { client } = fakeClient([
      weatherArgumentsResponse("first-group", {
        locations: ["Raleigh, NC", "Seattle, WA", "Denver, CO"],
      }),
      weatherArgumentsResponse("second-group", {
        locations: ["Miami, FL", "Boston, MA"],
      }),
      completedResponse("too-many-locations-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Compare Raleigh, Seattle, Denver, Miami, and Boston.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toThrow("more than 4 weather locations");

    expect(executeWeather).toHaveBeenCalledTimes(1);
  });

  it("bounds the number of weather function calls in a single tool round", async () => {
    const calls = Array.from({ length: 5 }, (_, index) => ({
      type: "function_call" as const,
      id: `weather-call-${index + 1}`,
      name: "get_weather_bundle",
      arguments: { location: `City ${index + 1}` },
    }));
    const { client } = fakeClient([
      {
        id: "interaction-many-calls",
        status: "requires_action",
        steps: calls,
      },
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Compare several cities.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toThrow("more than 4 weather tool calls");
    expect(executeWeather).not.toHaveBeenCalled();
  });

  it("preflights aggregate locations for a batch before executing any weather provider", async () => {
    const { client } = fakeClient([
      {
        id: "interaction-location-batch",
        status: "requires_action",
        steps: [
          {
            type: "function_call",
            id: "weather-three",
            name: "get_weather_bundle",
            arguments: { locations: ["Raleigh, NC", "Seattle, WA", "Denver, CO"] },
          },
          {
            type: "function_call",
            id: "weather-two",
            name: "get_weather_bundle",
            arguments: { locations: ["Miami, FL", "Boston, MA"] },
          },
        ],
      },
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Compare five cities.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toThrow("more than 4 weather locations");
    expect(executeWeather).not.toHaveBeenCalled();
  });

  it.each([
    ["fractional hours", { locations: ["Seattle, WA"], hours: 24.5 }],
    ["excess daily range", { locations: ["Seattle, WA"], days: 11 }],
    ["fractional duration", { locations: ["Denver, CO"], durationHours: 1.5 }],
  ])("rejects malformed integer weather arguments: %s", async (_label, arguments_) => {
    const { client } = fakeClient([
      weatherArgumentsResponse("malformed-range", arguments_),
      completedResponse("malformed-range-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Show the weather.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toBeInstanceOf(GeminiProviderError);
    expect(executeWeather).not.toHaveBeenCalled();
  });

  it("rejects mixed named-location modes", async () => {
    const { client } = fakeClient([
      weatherArgumentsResponse("mixed-location", {
        location: "Raleigh, NC",
        locations: ["Seattle, WA"],
      }),
      completedResponse("mixed-location-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await expect(
      runGeminiRetrieval({
        gemini: client,
        prompt: "Show Raleigh and Seattle weather.",
        clientContext,
        executeWeather,
      }),
    ).rejects.toBeInstanceOf(GeminiProviderError);
    expect(executeWeather).not.toHaveBeenCalled();
  });

  it("defers target-horizon validation until the executor has provider timezone slots", async () => {
    const { client } = fakeClient([
      weatherArgumentsResponse("target-too-far", {
        locations: ["Denver, CO"],
        activity: "run",
        durationHours: 6,
        targetLocalTime: "23:30",
        targetDayOffset: 9,
      }),
      completedResponse("target-too-far-complete"),
    ]);
    const executeWeather = vi.fn(() => Promise.resolve({ data: { ok: true } }));

    await runGeminiRetrieval({
      gemini: client,
      prompt: "Plan a six-hour run at 11:30 PM nine days from now in Denver.",
      clientContext,
      executeWeather,
    });
    expect(executeWeather).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLocalTime: "23:30",
        targetDayOffset: 9,
      }),
    );
  });

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
      model: "gemini-4-hydrogen",
      store: false,
      generation_config: { thinking_level: "medium" },
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

  it("preserves distinct bounded citation spans when one URL is annotated more than once", async () => {
    const text = "Gemini 4 is generally available. Gemini 4 removes the legacy endpoint.";
    const firstEnd = text.indexOf(" Gemini 4 removes");
    const { client } = fakeClient([
      {
        id: "search_duplicate_spans",
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/releases#status",
                    title: "Release notes",
                    start_index: 0,
                    end_index: firstEnd,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/releases#endpoint",
                    title: "Release notes",
                    start_index: firstEnd + 1,
                    end_index: new TextEncoder().encode(text).length,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Gemini 4?",
      clientContext,
      executeWeather: vi.fn(),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.searchEvidence).toMatchObject({ status: "complete" });
    expect(result.searchEvidence?.spans).toEqual([
      {
        sourceId: result.sources[0]?.id,
        ordinal: 0,
        text: "Gemini 4 is generally available.",
      },
      {
        sourceId: result.sources[0]?.id,
        ordinal: 1,
        text: "Gemini 4 removes the legacy endpoint.",
      },
    ]);
    expect(Object.isFrozen(result.searchEvidence)).toBe(true);
    expect(Object.isFrozen(result.searchEvidence?.spans)).toBe(true);
    expect(Object.isFrozen(result.searchEvidence?.spans[0])).toBe(true);
  });

  it("normalizes self-contained cited change sentences into a ready trusted manifest", async () => {
    const firstSentence = "Widget 2 adds offline mode.";
    const secondSentence =
      "Compared with Widget 1, Widget 2 removes the legacy endpoint.";
    const text = `${firstSentence} ${secondSentence}`;
    const firstEnd = new TextEncoder().encode(firstSentence).length;
    const { client } = fakeClient([
      {
        id: "search_manifest_compatible_changes",
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/widget-2-release#offline",
                    title: "Widget 2 release notes",
                    start_index: 0,
                    end_index: firstEnd,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/widget-2-release#legacy",
                    title: "Widget 2 release notes",
                    start_index: firstEnd + 1,
                    end_index: new TextEncoder().encode(text).length,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Widget 2?",
      clientContext,
      executeWeather: vi.fn(),
    });
    const manifest = buildResearchChangeManifest({
      prompt: "What changed in Widget 2?",
      sources: result.sources,
      searchEvidence: result.searchEvidence,
    });

    expect(result.searchEvidence).toMatchObject({ status: "complete" });
    expect(result.searchEvidence?.spans.map((span) => span.text)).toEqual([
      firstSentence,
      secondSentence,
    ]);
    expect(manifest.status).toBe("ready");
    if (manifest.status !== "ready") return;
    expect(manifest.manifest.subject).toBe("Widget 2");
    expect(manifest.manifest.entries.map((entry) => entry.coverageText)).toEqual([
      "adds offline mode",
      "removes the legacy endpoint",
    ]);
  });

  it("preserves a partial citation verbatim and lets the trusted manifest fail closed", async () => {
    const text = "Widget 2 adds offline mode.";
    const citedText = "adds offline mode.";
    const citedStart = new TextEncoder().encode("Widget 2 ").length;
    const { client } = fakeClient([
      {
        id: "search_partial_change_sentence",
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/widget-2-release#offline",
                    title: "Widget 2 release notes",
                    start_index: citedStart,
                    end_index: new TextEncoder().encode(text).length,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Widget 2?",
      clientContext,
      executeWeather: vi.fn(),
    });
    const manifest = buildResearchChangeManifest({
      prompt: "What changed in Widget 2?",
      sources: result.sources,
      searchEvidence: result.searchEvidence,
    });

    expect(result.searchEvidence).toMatchObject({ status: "complete" });
    expect(result.searchEvidence?.spans.map((span) => span.text)).toEqual([citedText]);
    expect(manifest).toMatchObject({ status: "unavailable", reason: "unscoped-change" });
  });

  it("marks citation evidence incomplete when the bounded total annotation capacity is exceeded", async () => {
    const clauses = Array.from(
      { length: MAX_SEARCH_EVIDENCE_SPANS + 1 },
      (_, index) => `Gemini 4 adds capability ${index}.`,
    );
    const text = clauses.join(" ");
    let byteOffset = 0;
    const annotations = clauses.map((clause, index) => {
      const start_index = byteOffset;
      const end_index = start_index + new TextEncoder().encode(clause).length;
      byteOffset = end_index + 1;
      return {
        type: "url_citation" as const,
        url: `https://example.com/releases#${index}`,
        title: "Release notes",
        start_index,
        end_index,
      };
    });
    const { client } = fakeClient([
      {
        id: "search_span_capacity",
        status: "completed",
        output_text: text,
        steps: [{ type: "model_output", content: [{ type: "text", text, annotations }] }],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Gemini 4?",
      clientContext,
      executeWeather: vi.fn(),
    });

    expect(result.searchEvidence).toMatchObject({
      status: "incomplete",
      reason: "annotation-capacity",
    });
    expect(result.searchEvidence?.spans).toHaveLength(MAX_SEARCH_EVIDENCE_SPANS);
  });

  it.each([
    {
      name: "an oversized cited span",
      reason: "oversize-span",
      text: `Gemini 4 adds ${"x".repeat(610)} and removes the legacy endpoint.`,
      annotation: (text: string) => ({
        type: "url_citation" as const,
        url: "https://example.com/releases",
        start_index: 0,
        end_index: new TextEncoder().encode(text).length,
      }),
    },
    {
      name: "a malformed cited byte range",
      reason: "missing-span",
      text: "Gemini 4 removes the legacy endpoint.",
      annotation: (text: string) => ({
        type: "url_citation" as const,
        url: "https://example.com/releases",
        start_index: 0,
        end_index: new TextEncoder().encode(text).length + 10,
      }),
    },
  ])("marks citation evidence incomplete for $name", async ({ reason, text, annotation }) => {
    const { client } = fakeClient([
      {
        id: `search_${reason}`,
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text, annotations: [annotation(text)] }],
          },
        ],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Gemini 4?",
      clientContext,
      executeWeather: vi.fn(),
    });

    expect(result.searchEvidence).toMatchObject({ status: "incomplete", reason });
    expect(result.searchEvidence?.spans).toHaveLength(0);
  });

  it("marks mixed valid and unsafe URL citations incomplete without issuing the unsafe source", async () => {
    const text = "Gemini 4 is generally available.";
    const range = {
      start_index: 0,
      end_index: new TextEncoder().encode(text).length,
    };
    const { client } = fakeClient([
      {
        id: "search_unsafe_mixed",
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  { type: "url_citation", url: "https://example.com/releases", ...range },
                  { type: "url_citation", url: "https://127.0.0.1/internal", ...range },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Gemini 4?",
      clientContext,
      executeWeather: vi.fn(),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.searchEvidence).toMatchObject({
      status: "incomplete",
      reason: "unsafe-citation",
    });
  });

  it("marks search evidence incomplete when final source capacity excludes a cited search source", async () => {
    const text = "Gemini 4 is generally available.";
    const { client } = fakeClient([
      functionCallResponse("weather_sources", "signed-weather-sources"),
      {
        id: "search_after_weather_sources",
        status: "completed",
        output_text: text,
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/releases",
                    start_index: 0,
                    end_index: new TextEncoder().encode(text).length,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const weatherSources = Array.from({ length: LIMITS.sources }, (_, index) => ({
      id: `src_weather${index}`,
      title: `Weather source ${index}`,
      url: `https://weather.example.com/${index}`,
      provider: "google-weather" as const,
      accessedAt: "2026-08-01T12:00:00.000Z",
    }));

    const result = await runGeminiRetrieval({
      gemini: client,
      prompt: "What changed in Gemini 4?",
      clientContext,
      executeWeather: vi.fn(() => Promise.resolve({ data: { ok: true }, sources: weatherSources })),
    });

    expect(result.sources).toHaveLength(LIMITS.sources);
    expect(result.sources.every((source) => source.provider === "google-weather")).toBe(true);
    expect(result.searchEvidence).toMatchObject({
      status: "incomplete",
      reason: "source-capacity",
      spans: [],
    });
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
