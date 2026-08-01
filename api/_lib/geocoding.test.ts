import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../_fixtures/google-geocoding.json" with { type: "json" };
import {
  GeocodingError,
  clearGeocodingCache,
  geocodeLocation,
  geocodeLocations,
  reverseGeocodeLocation,
} from "./geocoding.js";

describe("Google Geocoding v4 provider", () => {
  beforeEach(() => clearGeocodingCache());

  it("uses the v4 address endpoint and normalizes the first result", async () => {
    let requestedUrl: URL | undefined;
    let requestedHeaders: Headers | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
      requestedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json(fixture.forward));
    });

    const result = await geocodeLocation("Raleigh, NC", {
      apiKey: "test-key",
      fetchImpl,
      languageCode: "en",
      regionCode: "US",
      cacheTtlMs: 0,
    });

    expect(requestedUrl?.origin).toBe("https://geocode.googleapis.com");
    expect(requestedUrl?.pathname).toBe("/v4/geocode/address/Raleigh%2C%20NC");
    expect(requestedUrl?.searchParams.get("languageCode")).toBe("en");
    expect(requestedUrl?.searchParams.get("regionCode")).toBe("US");
    expect(requestedUrl?.searchParams.has("key")).toBe(false);
    expect(requestedHeaders?.get("X-Goog-Api-Key")).toBe("test-key");
    expect(requestedHeaders?.get("X-Goog-FieldMask")).toContain("results.location");
    expect(result).toEqual({
      query: "Raleigh, NC",
      name: "Raleigh, NC, USA",
      latitude: 35.7795897,
      longitude: -78.6381787,
      placeId: "ChIJ9-BRny9arIkRrfARilK2kGc",
      granularity: "APPROXIMATE",
      locality: "Raleigh",
      region: "NC",
      countryCode: "US",
      types: ["locality", "political"],
    });
  });

  it("uses the v4 reverse-geocoding endpoint", async () => {
    let requestedUrl: URL | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(Response.json(fixture.reverse));
    });

    const result = await reverseGeocodeLocation(
      { latitude: 35.7795897, longitude: -78.6381787 },
      { apiKey: "test-key", fetchImpl, cacheTtlMs: 0 },
    );

    expect(requestedUrl?.pathname).toBe("/v4/geocode/location/35.7795897,-78.6381787");
    expect(result).toMatchObject({
      name: "Raleigh, NC, USA",
      latitude: 35.7795897,
      longitude: -78.6381787,
      locality: "Raleigh",
      region: "NC",
      countryCode: "US",
    });
  });

  it("coarsens reverse-geocode cache identity and rebinds exact caller coordinates", async () => {
    const requestedUrls: URL[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      requestedUrls.push(new URL(input instanceof Request ? input.url : input.toString()));
      return Promise.resolve(Response.json(fixture.reverse));
    });
    const options = { apiKey: "test-key", fetchImpl, cacheTtlMs: 60_000 };
    const firstCoordinates = { latitude: 35.7795897, longitude: -78.6381787 };
    const nearbyCoordinates = { latitude: 35.7798, longitude: -78.6384 };

    const first = await reverseGeocodeLocation(firstCoordinates, options);
    const cached = await reverseGeocodeLocation(nearbyCoordinates, options);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestedUrls[0]?.pathname).toBe("/v4/geocode/location/35.7795897,-78.6381787");
    expect(first).toMatchObject(firstCoordinates);
    expect(cached).toMatchObject(nearbyCoordinates);
    expect(cached?.query).toBe("");
  });

  it("preserves input order, caches normalized queries, and enforces the four-location limit", async () => {
    let now = 5_000;
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(fixture.forward)));
    const options = { apiKey: "test-key", fetchImpl, cacheTtlMs: 60_000, now: () => now };

    const first = await geocodeLocations({ queries: [" Raleigh, NC ", "Durham, NC"], ...options });
    const second = await geocodeLocations(["raleigh, nc", "durham, nc"], options);
    expect(first.map((item) => item.query)).toEqual(["Raleigh, NC", "Durham, NC"]);
    expect(second.map((item) => item.query)).toEqual(["raleigh, nc", "durham, nc"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now += 60_001;
    await geocodeLocation("Raleigh, NC", options);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await expect(geocodeLocations(["one", "two", "three", "four", "five"], options)).rejects.toThrow(
      "A maximum of 4 locations is supported.",
    );
  });

  it("returns null for no matches and redacts secrets and coordinates from errors", async () => {
    const emptyFetch = vi.fn(() => Promise.resolve(Response.json({ results: [] })));
    await expect(geocodeLocation("Nowhere", { apiKey: "test-key", fetchImpl: emptyFetch, cacheTtlMs: 0 })).resolves.toBeNull();

    const failingFetch = vi.fn(() => Promise.resolve(Response.json({ error: { message: "denied" } }, { status: 403 })));
    const promise = reverseGeocodeLocation(
      { latitude: 35.7795897, longitude: -78.6381787 },
      { apiKey: "super-secret-key", fetchImpl: failingFetch, cacheTtlMs: 0 },
    );
    await expect(promise).rejects.toBeInstanceOf(GeocodingError);
    await expect(promise).rejects.not.toThrow(/super-secret-key|35\.7795897|-78\.6381787/);
  });

  it("turns non-finite or oversized cache TTLs into bounded entries", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(fixture.forward)));
    const base = { apiKey: "test-key", fetchImpl, now: () => now };

    await geocodeLocation("Raleigh, NC", { ...base, cacheTtlMs: Number.POSITIVE_INFINITY });
    now += 5 * 60 * 1_000 + 1;
    await geocodeLocation("Raleigh, NC", { ...base, cacheTtlMs: Number.POSITIVE_INFINITY });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clearGeocodingCache();
    await geocodeLocation("Durham, NC", { ...base, cacheTtlMs: 24 * 60 * 60 * 1_000 });
    now += 15 * 60 * 1_000 + 1;
    await geocodeLocation("Durham, NC", { ...base, cacheTtlMs: 24 * 60 * 60 * 1_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed successful payloads instead of caching them as no-match", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ status: "ok" })));
    const options = { apiKey: "test-key", fetchImpl, cacheTtlMs: 60_000 };

    await expect(geocodeLocation("Raleigh, NC", options)).rejects.toThrow(
      "Google Geocoding returned an invalid response.",
    );
    await expect(geocodeLocation("Raleigh, NC", options)).rejects.toBeInstanceOf(GeocodingError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
