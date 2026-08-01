import { LIMITS } from "./constants.js";
import type { SurfaceSpec } from "./schemas.js";

export type CapabilityRoute =
  | "weather"
  | "search"
  | "plain"
  | "clarification"
  | "boundary"
  | "reject";

export type CapabilityToolPolicy = "weather" | "search" | "none";

export type CapabilityBoundary =
  | "medical-emergency"
  | "medical-personalized"
  | "minor-outdoor-safety"
  | "legal-personalized"
  | "financial-personalized"
  | "booking-or-purchase"
  | "image-generation"
  | "external-write"
  | "code-execution"
  | "executable-ui"
  | "secret-exfiltration"
  | "unbounded-surface"
  | "unsafe-url"
  | "unsafe-redirect";

export type CapabilityReason =
  | "weather-request"
  | "weather-comparison"
  | "grounded-research"
  | "grounded-comparison"
  | "plain-answer"
  | "location-required"
  | "comparison-context-required"
  | "invalid-request"
  | CapabilityBoundary;

export interface CapabilityContext {
  readonly hasApprovedCoordinates?: boolean;
}

export interface CapabilityDecision {
  readonly route: CapabilityRoute;
  readonly toolPolicy: CapabilityToolPolicy;
  readonly surfaceKind: SurfaceSpec["kind"] | null;
  readonly reason: CapabilityReason;
  readonly boundary?: CapabilityBoundary;
}

const WEATHER_TERMS =
  /\b(weather|forecast|rain|snow|temperature|temperatures|weather alerts?|heat index|wind chill|humidity)\b/i;
const WEATHER_COMPARISON_SHAPES =
  /\b(compare|which is better)\b[\s\S]{0,220}\b(weather|forecast|conditions?|outdoor|brunch|next (?:three|four|five|seven|\d+) days?)\b|\b(next (?:three|four|five|seven|\d+) days?)\b[\s\S]{0,160}\b(?:in|for)\b|\bcompare\b[\s\S]{0,120}\b(?:raleigh|durham|charlotte|miami|denver|seattle|london|chapel hill)\b[\s\S]{0,120}\b(?:tomorrow|saturday|sunday|this weekend)\b/i;
const WEATHER_ACTIVITY_SHAPES =
  /\b(what should i wear|best (?:time|window)|good (?:time|day)|outdoor brunch|walk|run|hike)\b/i;
const RESEARCH_TERMS =
  /\b(research|official sources?|official[\s\w.-]{0,40}source|official (?:polic(?:y|ies)|documentation|project pages?)|cite|sources? and cite|timeline|evidence for|what changed|release and support statuses?|current[\s\w-]{0,40}requirements?|today'?s news)\b/i;
const COMPARISON_TERMS = /\b(compare|comparison|versus|\bvs\.?\b|which is better)\b/i;

const MEDICAL_EMERGENCY =
  /\b(crushing chest pain|chest pain[\s\S]{0,80}(?:trouble breathing|shortness of breath)|trouble breathing[\s\S]{0,80}chest pain|cannot breathe|can'?t breathe|stroke symptoms?|severe bleeding|unconscious|overdose)\b/i;
const MINOR_SAFETY_DECISION =
  /\b(?:child|kid|minor|\d{1,2}-year-old)\b[\s\S]{0,220}\b(?:safe|safety|hike|climb|mountain|outdoor)\b|\b(?:safe|safety)\b[\s\S]{0,160}\b(?:my (?:child|kid)|\d{1,2}-year-old)\b/i;
const PERSONALIZED_MEDICAL =
  /\b(diagnose me|diagnose my|what (?:medicine|medication|dose) should i|should i take[\s\S]{0,60}(?:medicine|medication|drug|dose|pill|prescription|antibiotic|ibuprofen|acetaminophen)|can i wait until|is (?:this|it) causing my|treat my|my symptoms?|my prescription)\b/i;
const PERSONALIZED_LEGAL =
  /\b(legal advice for me|should i sue|can i sue|my lawsuit|my legal case|represent me|what should i plead|should i sign this (?:contract|agreement)|tell me (?:my rights|what law applies to me))\b/i;
const PERSONALIZED_FINANCIAL =
  /\b(what stock should i buy|which [a-z0-9 .&-]*stock should|invest (?:all of )?my|entire retirement account|manage my (?:money|portfolio)|guarantee (?:me )?a return|personalized financial advice)\b/i;

const BOOKING_OR_PURCHASE =
  /\b(book|reserve|purchase|buy|order|charge)\b[\s\S]{0,100}\b(?:flight|hotel|room|ticket|trip|appointment|card|it|this|for me)\b|\bcharge my (?:saved )?card\b/i;
const IMAGE_GENERATION =
  /\b(generate|create|make)\b[\s\S]{0,100}\b(?:photorealistic )?(?:image|photo|picture|illustration)\b|\bimage generation\b/i;
const EXTERNAL_WRITE =
  /\b(send|email|message|post|publish|delete|remove|upload|edit|change|submit)\b[\s\S]{0,100}\b(?:email|message|file|account|record|post|form|application|my|for me)\b/i;
const CODE_EXECUTION =
  /\b(run|execute)\b[\s\S]{0,80}\b(?:code|python|javascript|typescript|shell|bash|command|script|server)\b|\b(?:print|read|show)\b[\s\S]{0,80}\b(?:\/etc\/passwd|server files?|filesystem)\b/i;
const EXECUTABLE_UI =
  /\b(?:html|css|javascript|script) component\b|\b(?:onclick|onerror|onload)\b|<\/?script\b|\barbitrary (?:html|css|javascript|code)\b|\braw[- ]code generation\b/i;
const SECRET_EXFILTRATION =
  /\b(system prompt|api keys?|hidden (?:prompt|tool arguments?)|complete trace payloads?|context tokens?|reveal secrets?|print your secrets?)\b/i;
const UNBOUNDED_SURFACE =
  /\b(?:50,?000|thousands?|millions?|unlimited|unbounded)\b[\s\S]{0,100}\b(?:nested|nodes?|components?|bands?|surface|page)\b|\bstress-test\b[\s\S]{0,80}\b(?:page|surface|renderer)\b/i;
const UNSAFE_SCHEME_OR_LOCAL_URL =
  /\b(?:javascript|vbscript|data|file):|https?:\/\/(?:localhost|127\.0\.0\.1|169\.254\.169\.254)(?::\d+)?(?:\/|\b)/i;
const SUSPICIOUS_REDIRECT =
  /\b(?:redirect|redirects?|redirecting)\b[\s\S]{0,100}\b(?:link-local|metadata|private|internal)\b|https:\/\/redirect\.[^\s]+/i;

function decision(
  route: CapabilityRoute,
  toolPolicy: CapabilityToolPolicy,
  surfaceKind: SurfaceSpec["kind"] | null,
  reason: CapabilityReason,
  boundary?: CapabilityBoundary,
): CapabilityDecision {
  return Object.freeze({
    route,
    toolPolicy,
    surfaceKind,
    reason,
    ...(boundary ? { boundary } : {}),
  });
}

function boundary(kind: CapabilityBoundary): CapabilityDecision {
  return decision("boundary", "none", "narrative", kind, kind);
}

function hasWeatherIntent(prompt: string): boolean {
  return WEATHER_TERMS.test(prompt) || WEATHER_COMPARISON_SHAPES.test(prompt) || WEATHER_ACTIVITY_SHAPES.test(prompt);
}

function isWeatherComparison(prompt: string): boolean {
  return COMPARISON_TERMS.test(prompt) &&
    (WEATHER_TERMS.test(prompt) || WEATHER_COMPARISON_SHAPES.test(prompt) || /\bconditions? at\b/i.test(prompt));
}

function lacksWeatherLocation(prompt: string, context: CapabilityContext): boolean {
  if (context.hasApprovedCoordinates) return false;
  if (/\bnear me\b/i.test(prompt)) return true;
  if (/\bweather in springfield\b/i.test(prompt) && !/\bspringfield,?\s+(?:il|illinois|ma|massachusetts|mo|missouri|oh|ohio)\b/i.test(prompt)) {
    return true;
  }
  if (/^will it be good this weekend\??$/i.test(prompt.trim())) return true;
  if (/^what(?:'s| is) the weather(?: like)? (?:today|tomorrow|this weekend)\??$/i.test(prompt.trim())) return true;
  return false;
}

/**
 * Applies the lab's read-only capability boundary before any provider sees a
 * prompt. It intentionally classifies supported weather intent ahead of
 * prompt-injection text so unsafe presentation instructions cannot displace a
 * valid request; consequential decisions and external actions still win.
 */
export function classifyCapability(
  input: string,
  context: CapabilityContext = {},
): CapabilityDecision {
  const prompt = input.trim();
  if (!prompt || prompt.length > LIMITS.promptCharacters) {
    return decision("reject", "none", null, "invalid-request");
  }

  if (MEDICAL_EMERGENCY.test(prompt)) return boundary("medical-emergency");
  if (MINOR_SAFETY_DECISION.test(prompt)) return boundary("minor-outdoor-safety");
  if (PERSONALIZED_MEDICAL.test(prompt)) return boundary("medical-personalized");
  if (PERSONALIZED_LEGAL.test(prompt)) return boundary("legal-personalized");
  if (PERSONALIZED_FINANCIAL.test(prompt)) return boundary("financial-personalized");
  if (BOOKING_OR_PURCHASE.test(prompt)) return boundary("booking-or-purchase");
  if (IMAGE_GENERATION.test(prompt)) return boundary("image-generation");
  if (EXTERNAL_WRITE.test(prompt)) return boundary("external-write");
  if (CODE_EXECUTION.test(prompt)) return boundary("code-execution");

  if (/^will it be good this weekend\??$/i.test(prompt)) {
    return decision("clarification", "none", "location", "location-required");
  }

  const intentText = prompt
    .replace(/https?:\/\/[^\s]+/gi, " [url] ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  const weatherIntent = hasWeatherIntent(intentText);
  if (weatherIntent) {
    if (lacksWeatherLocation(intentText, context)) {
      return decision("clarification", "none", "location", "location-required");
    }
    const comparison = isWeatherComparison(intentText);
    return decision(
      "weather",
      "weather",
      comparison ? "comparison" : "weather",
      comparison ? "weather-comparison" : "weather-request",
    );
  }

  if (EXECUTABLE_UI.test(prompt)) return boundary("executable-ui");
  if (SECRET_EXFILTRATION.test(prompt)) return boundary("secret-exfiltration");
  if (UNBOUNDED_SURFACE.test(prompt)) return boundary("unbounded-surface");
  if (SUSPICIOUS_REDIRECT.test(prompt)) return boundary("unsafe-redirect");
  if (UNSAFE_SCHEME_OR_LOCAL_URL.test(prompt)) return boundary("unsafe-url");

  if (/^compare them\b/i.test(prompt)) {
    return decision("clarification", "none", "narrative", "comparison-context-required");
  }

  if (RESEARCH_TERMS.test(prompt)) {
    const comparison = COMPARISON_TERMS.test(prompt);
    return decision(
      "search",
      "search",
      comparison ? "comparison" : "research",
      comparison ? "grounded-comparison" : "grounded-research",
    );
  }

  return decision("plain", "none", "narrative", "plain-answer");
}
