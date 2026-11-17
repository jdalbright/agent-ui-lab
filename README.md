# Agent UI Lab

Agent UI Lab is a portfolio proof of concept for agent-composed interfaces. A deterministic React shell accepts an open-ended prompt, while Gemini selects an approved retrieval path and composes a schema-constrained surface from a trusted component catalog. The browser never evaluates model-generated HTML, CSS, JavaScript, or arbitrary event handlers.

The first-class surfaces cover weather, comparisons, and grounded current research. Requests outside the read-only scope receive a bounded narrative response instead of an attempted external action.

## What this demonstrates

- React 19, Vite, TypeScript, and Vercel Functions
- Gemini `gemini-4-hydrogen` (thinking level `low` by default, tunable with `GEMINI_RETRIEVAL_THINKING` and `GEMINI_COMPOSITION_THINKING`) through the stable `v1` Interactions API with `store: false`
- A2UI v0.9.1 messages rendered through local adapters and versioned trusted React catalogs
- Stateless function-call continuation with Google Search grounding and normalized Google Weather data
- Agent-selected recipes plus an opt-in, server-validated generative composition grammar for weather, comparison, and research answers
- Responsive `compact`, `medium`, and `expanded` surfaces with an accessible trace inspector
- Validation, source provenance, safe fallback behavior, short-lived context, and anonymous rate limiting

See [Architecture](docs/architecture.md) for the complete request path and trust boundaries, and [Generative UI Grammar v3](docs/generative-ui-grammar-v3.md) for the freer composition contract.

## Quick start

Requirements: Node.js 20.19 or newer and npm.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The Vite-only server does not run `/api/agent`; when that request is unavailable on localhost, the browser replays the recorded provider surface that matches the prompt. This makes the interface testable without provider credentials and is clearly labeled in the UI.

To exercise the Vercel Function locally:

```sh
cp .env.example .env.local
npm run dev:full
```

`dev:full` requires the Vercel CLI. With both provider keys configured, the function uses the live pipeline. Without them, a non-production Vercel environment uses recorded fixtures.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Live mode | Server-only Gemini API key. |
| `GOOGLE_MAPS_API_KEY` | Live weather | Server-only key for Google Geocoding and Weather APIs. Live mode requires this and the Gemini key together. |
| `CONTEXT_ENCRYPTION_SECRET` | Production | Unique, non-placeholder secret of at least 32 characters used to derive the AES-256-GCM context-token key and the anonymous rate-limit salt. |
| `UPSTASH_REDIS_REST_URL` | Production rate limit | Upstash REST endpoint. Must be paired with the token. |
| `UPSTASH_REDIS_REST_TOKEN` | Production rate limit | Upstash REST token. Must be paired with the URL. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Production rate limit | Managed-name alternative supplied by Vercel's Upstash integration. |
| `ALLOWED_ORIGINS` | Production | Comma-separated exact origins accepted by `/api/agent`; production must include `https://lab.jalbright.dev`. Vercel's current preview origin is also accepted automatically. |
| `ALLOW_DEMO_FIXTURES` | Development only | Set to `true` only when recorded server fixtures should be allowed without live provider keys. Leave false or unset in production. |
| `SURFACE_COMPOSER_VERSION` | No | `spec-v1` keeps the original path, `plan-v2` uses validated recipes, and `grammar-v3` uses the constrained composition grammar for supported domains. |
| `SURFACE_GRAMMAR_V3_ROLLOUT_PERCENT` | Grammar v3 | Stable grammar-v3 allocation from `0` through `100`. Defaults to `100` only when `grammar-v3` is selected; use 10, 50, and 100 for a staged ramp. |

`VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_PROJECT_ID` are supplied by Vercel and should not be copied into local configuration unless a specific test requires them.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite client at `127.0.0.1`. |
| `npm run dev:full` | Run the Vite app and Vercel Functions through `vercel dev`. |
| `npm run build` | Type-check and create the production bundle. |
| `npm run preview` | Serve the production bundle locally. |
| `npm run typecheck` | Type-check the client, shared contracts, and API. |
| `npm run lint` | Run ESLint. |
| `npm run test:run` | Run the unit and component test suite once. |
| `npm run test:coverage` | Run tests with V8 coverage reports. |
| `npm run test:e2e` | Run Playwright against desktop and mobile projects. |
| `npm run eval` | Run the 40-prompt contract evaluation set. |
| `npm run eval:ui` | Validate recorded plan-v2 and grammar-v3 cases, build the app, then compare 51 Chromium reference screenshots with axe and overflow checks. |
| `npm run eval:ui:live` | Opt in to three live Gemini composition samples per recorded-evidence case (54 total); a Gemini key is required to run the samples. |
| `npm run eval:ui:live:v3` | Run the separate 54-sample grammar-v3 shadow gate against recorded evidence; no output is rendered to users. |

Provider tests use recorded Gemini Search, Geocoding, and Weather fixtures. They do not require live credentials. `eval:ui:live` calls only the composition stage: retrieval evidence stays recorded while Gemini selects a plan that is validated, compiled, scored by the deterministic quality linter, and checked against each case's explicit ordered-component and semantic-variant contract. Its bounded per-case diagnostics report quality validity separately from structural conformance. Without `GEMINI_API_KEY`, its guarded test confirms that live sampling is disabled. Live-provider smoke checks are intentionally separate from the default test suite.

## Weather retrieval coverage

One weather tool call can resolve one to four named locations in request order, or one browser-approved coordinate pair. Retrieval accepts 1–240 hourly records and 1–10 daily records; defaults are 24 hours and seven days. Weather and weather-comparison surfaces can present up to 24 hourly or 10 daily entries. Longer hourly retrieval supports future activity targets rather than a 240-row UI. The aggregate four-location and two-tool-round limits still apply if Gemini makes more than one call.

Activity requests retain a bounded activity label, a whole-hour duration from one to six hours, and an optional local start time/day offset. Server code retrieves enough hourly evidence and scores the best or explicitly requested window for each location. Gemini can select those records but cannot calculate or replace their measurements.

## Trusted rendering model

Gemini returns semantic data, not executable presentation code. Plan v2 selects a validated recipe and modules. Grammar v3 instead selects evidence-backed content plus a bounded adjacency-list layout made from semantic primitives. Weather planning uses a qualitative, index-preserving manifest; raw measurements, coordinates, provider steps, and source URLs stay server-side. Server-owned code resolves evidence references and deterministically compiles either plan into `SurfaceSpec → A2UI v0.9.1`. The browser still receives only `createSurface`, `updateDataModel`, and `updateComponents`.

- Layout and content: `SurfaceFrame`, `EditorialHeading`, `TextBlock`, `Metric`, `Band`, `Split`, `Rail`, `Divider`
- Grammar-v3 layout: `Stack`, `Grid`, `Section`, `Card`, `Tabs`, `Disclosure` plus the trusted shared layout primitives
- Weather: `WeatherHero`, `RecommendationBand`, `HourlyForecast`, `DailyForecast`, `WeatherAlert`, `LocationPrompt`
- Comparison: `ComparisonSummary`, `ComparisonTable`, `ComparisonChart`
- Research: `ResearchLead`, `EvidenceList`, `Timeline`, `SourceList`

The protocol is pinned to v0.9.1 even though the compatible renderer packages have later package versions. Imports and message processing stay behind `src/lib/a2ui` so the preview dependency can be replaced without changing the agent contract.

### Surface recipes

The nine recipes express question-specific hierarchy without allowing generated markup or styles:

| Domain | Recipe | Best fit |
| --- | --- | --- |
| Weather | `weather.snapshot` | Conditions at a place and time, with the answer first. |
| Weather | `weather.decision` | Choosing when or whether to do an activity. |
| Weather | `weather.outlook` | A requested multi-day or multi-hour forecast range. |
| Comparison | `comparison.verdict` | A direct recommendation between options. |
| Comparison | `comparison.scorecard` | Criteria-by-criteria trade-offs and balanced scoring. |
| Comparison | `comparison.trend` | Change over time where a chart and aligned table matter. |
| Research | `research.brief` | A concise, current, source-grounded explanation. |
| Research | `research.timeline` | Chronology is the clearest way to answer the question. |
| Research | `research.claims` | Evidence should be separated into support, challenge, and neutral claims. |

`SurfaceFrame` carries only enum-valued recipe, density, and emphasis metadata. Every layout, chart, table, and responsive rule remains application-owned. Weather numbers are copied from normalized provider evidence, and search-backed claims retain server-issued source IDs. Weather-backed comparison modules carry only location, forecast, and metric references; the compiler derives summary measurements/items, table cells, chart labels, and chart series from normalized evidence. Plans cannot contain URLs, CSS, HTML, JavaScript, arbitrary component names, or event handlers.

Every plan must end with exactly one sources module. Each cited source—including implicit Google Weather and alert-authority attribution—must appear there, and every listed ID must have been issued by the server. The planner never receives authority to add or replace a URL.

Composition allows one complete replacement repair for invalid or un-compilable output. A second failure selects a deterministic domain fallback when the required trusted evidence exists: Weather Snapshot, Comparison Verdict, or Research Brief. Retrieval/provider failures still use the outer bounded narrative fallback. Effective plan budgets are 6, 9, or 12 modules for `brief`, `balanced`, or `detailed` density, with a 60-node compiled-surface limit and the existing six-level graph limit.

## Privacy and security

- Conversation state lives only in React memory. There are no accounts, cookies, local storage entries, or application database.
- An optional 30-minute AES-256-GCM token carries at most three compact, sanitized turn summaries. Invalid or expired tokens are ignored.
- Both Gemini stages set `store: false`.
- The structured logging schema is limited to request IDs, stage durations, tool outcomes, optional token counts, recipe ID, density, emphasis, validation category, repair count, component/source counts, and stable error codes. It does not intentionally include prompt bodies, evidence bodies, coordinates, provider steps, API keys, or context tokens.
- Inspector traces allow only a small argument-key allowlist and redact emails, credentials, and coordinate-like values. They expose no model reasoning or hidden instructions.
- The inspector may explain recipe, density, emphasis, bounded quality-check outcomes, repair category, and compiler result. It never exposes model reasoning, evidence bodies, or hidden instructions.
- Sources are server-normalized, capped at eight, and restricted to HTTPS. The model may cite existing source IDs but cannot supply replacement URLs.
- The function enforces an exact origin allowlist, a 45-second deadline, 20 requests per 10 minutes, and 100 requests per day per anonymized identity.
- Security headers include a same-origin Content Security Policy, frame denial, content-type sniffing protection, a strict referrer policy, and a restricted Permissions Policy.

Production startup fails closed unless both Upstash variables, both live-provider keys, a strong context secret, and the exact custom-domain origin are configured. The in-memory rate limiter is a local/development fallback and is not shared across serverless instances.

## Extending the lab

“Almost anything” is an architectural direction, not permission for arbitrary code or plugins. A new domain should add, together:

1. A typed server-side tool with bounded inputs.
2. A normalized evidence schema and immutable source records.
3. Semantic components in the trusted catalog.
4. A bounded planner recipe/module contract, deterministic fallback, and server/client validation.
5. Recorded provider fixtures, unit tests, accessibility coverage, and evaluation cases.

Keep external writes, purchases, bookings, uploads, arbitrary code execution, and personalized high-stakes advice outside this version's boundary.

## Deployment

The project targets Vercel. Before deploying, complete [the release checklist](docs/release-checklist.md), configure production environment variables in Vercel, and run:

```sh
npm run build
vercel --prod
```

Attach `lab.jalbright.dev` only after the production deployment passes the direct Vercel URL smoke test. Do not add the project to the portfolio until the exact custom domain has been tested with live-provider, fallback, inspector, mobile, and accessibility flows.

For the Surface Quality rollout, leave `SURFACE_COMPOSER_VERSION` unset or set to `spec-v1` in production while validating `plan-v2` with live providers on a Vercel preview. A human must review all nine recipes at 320, 390, 768, and 1440 pixels for relevance, hierarchy, scanability, and balance before production changes. After that approval, switch production to `plan-v2` and repeat smoke tests. Roll back immediately by restoring `spec-v1`; no code rollback is required.

## License

[MIT](LICENSE)
