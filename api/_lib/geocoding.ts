const GEOCODING_BASE_URL = "https://geocode.googleapis.com";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_LOCATIONS = 4;
const COARSE_COORDINATE_DECIMALS = 2;

// Geocoding API v4 address and reverse-geocoding request forms:
// https://developers.google.com/maps/documentation/geocoding/geocoding
// https://developers.google.com/maps/documentation/geocoding/reverse-geocoding
const GEOCODING_FIELD_MASK = [
  "results.placeId",
  "results.location",
  "results.granularity",
  "results.formattedAddress",
  "results.postalAddress",
  "results.addressComponents",
  "results.types",
].join(",");

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeocodedLocation extends Coordinates {
  query: string;
  name: string;
  placeId?: string;
  granularity?: string;
  locality?: string;
  region?: string;
  countryCode?: string;
  types: string[];
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GeocodingOptions {
  apiKey?: string;
  locale?: string;
  languageCode?: string;
  regionCode?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface GeocodeLocationsInput extends GeocodingOptions {
  queries: readonly string[];
  apiKey: string;
}

interface GoogleGeocodeResult {
  placeId?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  granularity?: unknown;
  formattedAddress?: unknown;
  postalAddress?: {
    regionCode?: unknown;
    administrativeArea?: unknown;
    locality?: unknown;
  };
  types?: unknown;
}

type ForwardCacheValue = Omit<GeocodedLocation, "query">;
type ReverseCacheValue = Omit<GeocodedLocation, "query" | "latitude" | "longitude">;

interface ForwardCacheEntry {
  kind: "forward";
  expiresAt: number;
  value: ForwardCacheValue | null;
}

interface ReverseCacheEntry {
  kind: "reverse";
  expiresAt: number;
  value: ReverseCacheValue | null;
}

type CacheEntry = ForwardCacheEntry | ReverseCacheEntry;
type CacheKind = CacheEntry["kind"];

const cache = new Map<string, CacheEntry>();

export class GeocodingError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeocodingError";
    this.status = status;
  }
}

export function clearGeocodingCache(): void {
  cache.clear();
}

function requiredApiKey(apiKey?: string): string {
  const resolved = apiKey?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!resolved) throw new GeocodingError("Google Maps API key is required.");
  return resolved;
}

function normalizedQuery(query: string): string {
  const value = query.trim().replace(/\s+/g, " ");
  if (!value || value.length > 240) {
    throw new GeocodingError("Each location query must contain between 1 and 240 characters.");
  }
  return value;
}

function normalizedLocale(options: GeocodingOptions): string {
  return (options.locale || options.languageCode || "en").trim() || "en";
}

function validateCoordinates(coordinates: Coordinates): void {
  if (
    !Number.isFinite(coordinates.latitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new GeocodingError("Valid latitude and longitude values are required.");
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeResult(raw: GoogleGeocodeResult, query: string): GeocodedLocation | null {
  const latitude = raw.location?.latitude;
  const longitude = raw.location?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const postalAddress = raw.postalAddress;
  const name = stringValue(raw.formattedAddress) ?? stringValue(postalAddress?.locality) ?? "Resolved location";
  return {
    query,
    name,
    latitude,
    longitude,
    ...(stringValue(raw.placeId) ? { placeId: stringValue(raw.placeId) } : {}),
    ...(stringValue(raw.granularity) ? { granularity: stringValue(raw.granularity) } : {}),
    ...(stringValue(postalAddress?.locality) ? { locality: stringValue(postalAddress?.locality) } : {}),
    ...(stringValue(postalAddress?.administrativeArea)
      ? { region: stringValue(postalAddress?.administrativeArea) }
      : {}),
    ...(stringValue(postalAddress?.regionCode) ? { countryCode: stringValue(postalAddress?.regionCode) } : {}),
    types: Array.isArray(raw.types) ? raw.types.filter((type): type is string => typeof type === "string") : [],
  };
}

function cacheLookup(key: string, now: number): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

function reverseCacheValue(value: GeocodedLocation): ReverseCacheValue {
  return {
    name: value.name,
    ...(value.placeId ? { placeId: value.placeId } : {}),
    ...(value.granularity ? { granularity: value.granularity } : {}),
    ...(value.locality ? { locality: value.locality } : {}),
    ...(value.region ? { region: value.region } : {}),
    ...(value.countryCode ? { countryCode: value.countryCode } : {}),
    types: [...value.types],
  };
}

function cacheStore(
  key: string,
  value: GeocodedLocation | null,
  kind: CacheKind,
  now: number,
  ttlMs: number,
): void {
  if (ttlMs <= 0) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  if (!value) {
    cache.set(key, { kind, value: null, expiresAt: now + ttlMs } as CacheEntry);
    return;
  }

  const metadata = reverseCacheValue(value);
  if (kind === "reverse") {
    cache.set(key, { kind, value: metadata, expiresAt: now + ttlMs });
    return;
  }
  cache.set(key, {
    kind,
    value: { ...metadata, latitude: value.latitude, longitude: value.longitude },
    expiresAt: now + ttlMs,
  });
}

function materializeCacheEntry(
  entry: CacheEntry,
  query: string,
  coordinates?: Coordinates,
): GeocodedLocation | null {
  if (!entry.value) return null;
  if (entry.kind === "reverse") {
    if (!coordinates) return null;
    return { ...entry.value, ...coordinates, query };
  }
  return { ...entry.value, query };
}

function coarseCoordinate(value: number): string {
  return value.toFixed(COARSE_COORDINATE_DECIMALS);
}

function cacheTtl(options: GeocodingOptions): number {
  const requested = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(requested)) return DEFAULT_CACHE_TTL_MS;
  return Math.min(MAX_CACHE_TTL_MS, Math.max(0, requested));
}

async function requestFirstResult(
  url: URL,
  query: string,
  cacheKey: string,
  options: GeocodingOptions,
  cacheKind: CacheKind = "forward",
  callerCoordinates?: Coordinates,
): Promise<GeocodedLocation | null> {
  const apiKey = requiredApiKey(options.apiKey);
  const now = options.now?.() ?? Date.now();
  const ttlMs = cacheTtl(options);
  const cached = cacheLookup(cacheKey, now);
  if (cached) return materializeCacheEntry(cached, query, callerCoordinates);

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GEOCODING_FIELD_MASK,
      },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GeocodingError("Google Geocoding request could not be completed.");
  }

  if (!response.ok) {
    throw new GeocodingError("Google Geocoding request failed.", response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GeocodingError("Google Geocoding returned an invalid response.", response.status);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { results?: unknown }).results)
  ) {
    throw new GeocodingError("Google Geocoding returned an invalid response.", response.status);
  }
  const results = (payload as { results: GoogleGeocodeResult[] }).results;
  const value = results.length > 0 ? normalizeResult(results[0], query) : null;
  cacheStore(cacheKey, value, cacheKind, now, ttlMs);
  if (cacheKind === "reverse") {
    const transientEntry: ReverseCacheEntry = {
      kind: "reverse",
      expiresAt: now + ttlMs,
      value: value ? reverseCacheValue(value) : null,
    };
    return materializeCacheEntry(transientEntry, query, callerCoordinates);
  }
  return value;
}

export async function geocodeLocation(
  query: string,
  options: GeocodingOptions = {},
): Promise<GeocodedLocation | null> {
  const cleanedQuery = normalizedQuery(query);
  const languageCode = normalizedLocale(options);
  const regionCode = options.regionCode?.trim().toUpperCase();
  const url = new URL(`/v4/geocode/address/${encodeURIComponent(cleanedQuery)}`, GEOCODING_BASE_URL);
  url.searchParams.set("languageCode", languageCode);
  if (regionCode) url.searchParams.set("regionCode", regionCode);

  const cacheKey = ["address", cleanedQuery.toLocaleLowerCase("en-US"), languageCode, regionCode ?? ""].join("|");
  return requestFirstResult(url, cleanedQuery, cacheKey, options);
}

export async function reverseGeocodeLocation(
  coordinates: Coordinates,
  options: GeocodingOptions = {},
): Promise<GeocodedLocation | null> {
  validateCoordinates(coordinates);
  const languageCode = normalizedLocale(options);
  const regionCode = options.regionCode?.trim().toUpperCase();
  const coordinatePair = `${coordinates.latitude},${coordinates.longitude}`;
  const url = new URL(`/v4/geocode/location/${coordinatePair}`, GEOCODING_BASE_URL);
  url.searchParams.set("languageCode", languageCode);
  if (regionCode) url.searchParams.set("regionCode", regionCode);

  const coarseCell = `${coarseCoordinate(coordinates.latitude)},${coarseCoordinate(coordinates.longitude)}`;
  const cacheKey = ["location", coarseCell, languageCode, regionCode ?? ""].join("|");
  return requestFirstResult(url, "", cacheKey, options, "reverse", coordinates);
}

export function geocodeLocations(input: GeocodeLocationsInput): Promise<GeocodedLocation[]>;
export function geocodeLocations(
  queries: readonly string[],
  options?: GeocodingOptions,
): Promise<GeocodedLocation[]>;
export async function geocodeLocations(
  input: GeocodeLocationsInput | readonly string[],
  legacyOptions: GeocodingOptions = {},
): Promise<GeocodedLocation[]> {
  const canonicalInput = Array.isArray(input)
    ? { ...legacyOptions, queries: input }
    : (input as GeocodeLocationsInput);
  if (canonicalInput.queries.length > MAX_LOCATIONS) {
    throw new RangeError(`A maximum of ${MAX_LOCATIONS} locations is supported.`);
  }

  const cleanedQueries = canonicalInput.queries.map(normalizedQuery);
  const results = await Promise.all(cleanedQueries.map((query) => geocodeLocation(query, canonicalInput)));
  return results.filter((result): result is GeocodedLocation => result !== null);
}
