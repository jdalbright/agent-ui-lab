# Agent UI Lab

Agent UI Lab is a portfolio proof of concept for agent-composed interfaces. A deterministic React shell accepts an open-ended prompt, while Gemini selects an approved retrieval path and composes a schema-constrained surface from a trusted component catalog. The browser never evaluates model-generated HTML, CSS, JavaScript, or arbitrary event handlers.

The first-class surfaces cover weather, comparisons, and grounded current research. Requests outside the read-only scope receive a bounded narrative response instead of an attempted external action.

## What this demonstrates

- React 19, Vite, TypeScript, and Vercel Functions
- Gemini `gemini-3.6-flash` through the stable `v1` Interactions API with `store: false`
- A2UI v0.9.1 messages rendered through local adapters and a 20-component React catalog
- Stateless function-call continuation with Google Search grounding and normalized Google Weather data
- Responsive `compact`, `medium`, and `expanded` surfaces with an accessible trace inspector
- Validation, source provenance, safe fallback behavior, short-lived context, and anonymous rate limiting

See [Architecture](docs/architecture.md) for the complete request path and trust boundaries.

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

Provider tests use recorded Gemini Search, Geocoding, and Weather fixtures. They do not require live credentials. Live-provider smoke checks are intentionally separate from the default test suite.

## Trusted rendering model

Gemini returns semantic data, not executable presentation code. The server accepts only the catalog components below, validates their props and graph, and compiles a valid `SurfaceSpec` into the three official A2UI messages: `createSurface`, `updateDataModel`, and `updateComponents`.

- Layout and content: `EditorialHeading`, `TextBlock`, `Metric`, `Band`, `Split`, `Rail`, `Divider`
- Weather: `WeatherHero`, `RecommendationBand`, `HourlyForecast`, `DailyForecast`, `WeatherAlert`, `LocationPrompt`
- Comparison: `ComparisonSummary`, `ComparisonTable`, `ComparisonChart`
- Research: `ResearchLead`, `EvidenceList`, `Timeline`, `SourceList`

The protocol is pinned to v0.9.1 even though the compatible renderer packages have later package versions. Imports and message processing stay behind `src/lib/a2ui` so the preview dependency can be replaced without changing the agent contract.

## Privacy and security

- Conversation state lives only in React memory. There are no accounts, cookies, local storage entries, or application database.
- An optional 30-minute AES-256-GCM token carries at most three compact, sanitized turn summaries. Invalid or expired tokens are ignored.
- Both Gemini stages set `store: false`.
- The structured logging schema is limited to request IDs, stage durations, tool outcomes, optional token counts, repair counts, component/source counts, and stable error codes. It does not intentionally include prompt bodies, coordinates, provider steps, API keys, or context tokens.
- Inspector traces allow only a small argument-key allowlist and redact emails, credentials, and coordinate-like values. They expose no model reasoning or hidden instructions.
- Sources are server-normalized, capped at eight, and restricted to HTTPS. The model may cite existing source IDs but cannot supply replacement URLs.
- The function enforces an exact origin allowlist, a 45-second deadline, 20 requests per 10 minutes, and 100 requests per day per anonymized identity.
- Security headers include a same-origin Content Security Policy, frame denial, content-type sniffing protection, a strict referrer policy, and a restricted Permissions Policy.

Production startup fails closed unless both Upstash variables, both live-provider keys, a strong context secret, and the exact custom-domain origin are configured. The in-memory rate limiter is a local/development fallback and is not shared across serverless instances.

## Extending the lab

“Almost anything” is an architectural direction, not permission for arbitrary code or plugins. A new domain should add, together:

1. A typed server-side tool with bounded inputs.
2. A normalized evidence schema and immutable source records.
3. Semantic components in the trusted catalog.
4. Composition-schema entries and server/client validation.
5. Recorded provider fixtures, unit tests, accessibility coverage, and evaluation cases.

Keep external writes, purchases, bookings, uploads, arbitrary code execution, and personalized high-stakes advice outside this version's boundary.

## Deployment

The project targets Vercel. Before deploying, complete [the release checklist](docs/release-checklist.md), configure production environment variables in Vercel, and run:

```sh
npm run build
vercel --prod
```

Attach `lab.jalbright.dev` only after the production deployment passes the direct Vercel URL smoke test. Do not add the project to the portfolio until the exact custom domain has been tested with live-provider, fallback, inspector, mobile, and accessibility flows.

## License

[MIT](LICENSE)
