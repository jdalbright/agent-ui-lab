# Release checklist

Use this checklist for the first public release and subsequent production changes. It records required evidence; checking a box should mean the result was observed, not assumed.

## Scope and repository

- [ ] Confirm the release remains anonymous, read-only, light-theme, and English-first.
- [ ] Confirm no account, database, upload, voice, purchase, booking, external-write, arbitrary-code, or plugin path was introduced.
- [ ] Review the complete dependency tree and run `npm audit --omit=dev`.
- [ ] Search tracked and staged files for API keys, provider payloads, context tokens, `.env` files, coordinates, and other secrets.
- [ ] Confirm `.env.local`, Vercel state, test artifacts, coverage, and provider responses are excluded from the public repository.
- [ ] Review the staged diff and include only Agent UI Lab files.
- [ ] Create or update the public `jdalbright/agent-ui-lab` repository only after the secret and staged-diff review.

## Automated verification

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:run`
- [ ] `npm run eval`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] The 40-prompt evaluation has zero unknown components and zero unsafe URLs.
- [ ] Every evaluation produces a valid surface or the deterministic safe fallback.
- [ ] Every research evidence item references a source ID supplied by the server.

The default test suite must use recorded Gemini Search, Geocoding, and Weather fixtures. Run live-provider checks separately so CI is deterministic and does not consume provider quota.

## Interaction and accessibility

- [ ] Verify the weather, researched comparison, and current-research example prompts end to end.
- [ ] Verify a follow-up uses the encrypted context token and a new prompt clears it.
- [ ] Verify ambiguous location, denied geolocation, provider error, timeout, retry, interrupted/partial stream, validation repair, and safe fallback states.
- [ ] Verify the inspector's Trace and UI Structure tabs show only sanitized metadata and remain keyboard operable.
- [ ] Verify visible focus, accessible names, chart text/table alternatives, and reduced-motion behavior.
- [ ] Run axe checks with no serious or critical findings.
- [ ] Check 320px, 390px, 768px, and 1440×1024 viewports with no horizontal overflow.
- [ ] Compare first load, weather answer, inspector, and mobile reflow screenshots with the approved visual concepts.
- [ ] Measure the deterministic shell with Lighthouse and confirm accessibility 100 and scores of at least 90 for the other required categories before recording the result.

## Production environment

- [ ] `GEMINI_API_KEY` is configured server-side and restricted to the required Gemini service.
- [ ] `GOOGLE_MAPS_API_KEY` is configured server-side with Google Geocoding and Weather API restrictions.
- [ ] Google Maps billing, quotas, usage alerts, and billing alerts are configured.
- [ ] `CONTEXT_ENCRYPTION_SECRET` is randomly generated, at least 32 characters, and stored as a sensitive production value.
- [ ] A complete Upstash REST pair (`UPSTASH_REDIS_REST_*` or Vercel-managed `KV_REST_API_*`) is configured; production is not relying on process-local rate-limit state.
- [ ] `ALLOWED_ORIGINS` contains only exact intended origins.
- [ ] `ALLOW_DEMO_FIXTURES` is false or unset.
- [ ] Vercel preview and production environment scopes are reviewed independently.
- [ ] Gemini retrieval and composition still set `store: false`.
- [ ] Provider keys, prompt bodies, coordinates, provider steps, and context tokens are absent from logs.

## Deploy and smoke test

- [ ] Deploy the verified build with `vercel --prod` and record the immutable deployment URL.
- [ ] Check `GET /api/health` on the production deployment.
- [ ] Submit a live weather prompt and confirm current provider mode, source attribution, and the deterministic activity recommendation.
- [ ] Submit a grounded research prompt and confirm every evidence item resolves to an immutable HTTPS source.
- [ ] Submit an unsupported external action and confirm the explicit read-only capability boundary.
- [ ] Confirm rate-limit headers and a controlled 429 response without affecting unrelated users.
- [ ] Confirm retry, provider failure, and safe fallback do not expose internal errors.
- [ ] Confirm the production response headers include the configured CSP, frame denial, referrer, content-type, and permissions policies.
- [ ] Attach `lab.jalbright.dev` only after the direct deployment URL passes.
- [ ] Repeat the smoke tests against the exact `https://lab.jalbright.dev` origin.
- [ ] Confirm the custom domain is the origin in the browser request and is accepted by the API allowlist.

## Portfolio release

- [ ] Capture a real screenshot from the verified custom-domain deployment; do not use concept art.
- [ ] Add Agent UI Lab first in Featured Work with both live-demo and public-source links.
- [ ] Add the case study without changing unrelated portfolio content or documentation.
- [ ] Publish only performance, accessibility, reliability, or evaluation metrics measured from the finished production system.
- [ ] Build and test the portfolio at desktop and mobile sizes.
- [ ] Deploy the portfolio and verify its Agent UI Lab demo, source, image, and case-study links in production.
