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
- [ ] `npm run eval:ui`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] The 40-prompt evaluation has zero unknown components and zero unsafe URLs.
- [ ] Every evaluation produces a valid surface or the deterministic safe fallback.
- [ ] Every research evidence item references a source ID supplied by the server.
- [ ] All 18 recorded plan/evidence pairs validate, compile with the production SurfacePlan compiler, pass SurfaceSpec validation, and pass the deterministic quality linter.
- [ ] The quality linter confirms answer-first hierarchy, sources-last ordering, requested coverage, chart/table alignment, source closure, and bounded density.
- [ ] The 36 recipe/viewport and 15 grammar-v3/viewport screenshots match their checked-in references with no serious/critical axe findings or document overflow.

`npm run eval:ui` runs the compiler-backed semantic fixtures, production build, and 51 Chromium screenshot cases. The default test suite and CI must use recorded Gemini Search, Geocoding, and Weather fixtures. CI must not receive provider secrets or run either live UI evaluation command. Run those opt-in commands separately: each uses live Gemini composition for 54 samples but keeps Search, Geocoding, and Weather evidence recorded.

## Surface Quality preview acceptance

- [ ] Production remains unset or explicitly set to `SURFACE_COMPOSER_VERSION=spec-v1` while preview review is in progress.
- [ ] A Vercel preview is configured with `SURFACE_COMPOSER_VERSION=plan-v2`.
- [ ] The preview has scoped live Gemini and Google Maps provider keys and reports live mode rather than replaying recorded fixtures.
- [ ] The preview selects each of the nine recipes for at least one representative prompt.
- [ ] Intent changes produce the expected structural change rather than random visual variation.
- [ ] One-to-four-location retrieval, bounded activity/time requests, and supported presentation ranges preserve their evidence: up to 24 hourly or 10 daily entries for Weather and weather-comparison surfaces.
- [ ] Weather-backed comparisons use evidence-derived measurements, aligned table/chart references, and complete server-issued sources.
- [ ] Requested locations, units, time ranges, comparison criteria, and cited evidence are preserved at every target width.
- [ ] The inspector reports only recipe, density, emphasis, quality-check outcomes, repair category, compiler result, counts, and timings.
- [ ] Invalid first-pass plans receive one replacement repair; a second failure produces the appropriate deterministic domain recipe.
- [ ] Every plan has exactly one final Sources module; every content citation is listed and every listed ID was issued by the server.
- [ ] The original `spec-v1` path remains smoke-tested as the rollback target.
- [ ] If the opt-in live benchmark is run, record separate quality-valid and structural-conformance totals plus first-pass quality validity, repair, fallback, latency, recipe selection, and diagnostic fingerprint IDs. Emit one bounded safe record per case without logging prompts or evidence bodies.
- [ ] Do not publish the ≥95% first-pass target as achieved until at least 52 of the 54 observed samples pass first validation.

## Interaction and accessibility

- [ ] Verify the weather, researched comparison, and current-research example prompts end to end.
- [ ] Verify a follow-up uses the encrypted context token and a new prompt clears it.
- [ ] Verify ambiguous location, denied geolocation, provider error, timeout, retry, interrupted/partial stream, validation repair, and safe fallback states.
- [ ] Verify the inspector's Trace and UI Structure tabs show only sanitized metadata and remain keyboard operable.
- [ ] Verify visible focus, accessible names, chart text/table alternatives, and reduced-motion behavior.
- [ ] Run axe checks with no serious or critical findings.
- [ ] Check 320px, 390px, 768px, and 1440×1024 viewports with no horizontal overflow.
- [ ] Compare first load, weather answer, inspector, and mobile reflow screenshots with the approved visual concepts.
- [ ] Compare the checked-in reference surface for each of the nine recipes at 320px, 390px, 768px, and 1440px.
- [ ] Confirm each reference surface preserves its supported requested range and has no serious or critical axe findings.
- [ ] A human reviews every live Vercel preview recipe at all four widths and records at least 4/5 for relevance, hierarchy, scanability, and visual balance; checked-in screenshots or model scores are not sufficient approval.
- [ ] Measure the deterministic shell with Lighthouse and confirm accessibility 100 and scores of at least 90 for the other required categories before recording the result.

## Grammar v3 shadow and ramp

- [ ] Keep production on `plan-v2` while grammar v3 is evaluated and reviewed.
- [ ] Run `npm run eval:ui:live:v3` against all 18 recorded-evidence cases and record 54/54 final quality-valid, 54/54 invariant-conformant, at least 52/54 first-pass valid, zero unsafe outputs, and zero fallback uses.
- [ ] Confirm exact recipe trees and presentation-only variants are telemetry only; facts, requested coverage, graph integrity, answer-first order, visible sources, citations, alignment, and budgets remain hard gates.
- [ ] Confirm every grammar-v3 A2UI stream declares `https://lab.jalbright.dev/catalogs/editorial/v3`, while a deterministic fallback declares the existing plan-v2 catalog.
- [ ] Test valid alternative Stack, Grid, Split, Section, Card, Rail, Tabs, Disclosure, and Divider compositions without accepting unknown tokens, raw visual values, code, URLs, or actions.
- [ ] Verify cycles, unreachable nodes, shared children, duplicate content, hidden primary answers, hidden alerts, hidden sources, nested interactions, excessive depth, and excessive node counts fail closed.
- [ ] Verify tabs with Tab, arrow, Home, and End keys and screen-reader semantics; verify disclosure names/state; verify both under reduced motion.
- [ ] Review representative grammar-v3 surfaces at 320, 390, 768, 1024, and 1440 pixels with no containment or document overflow defects and no serious/critical axe findings.
- [ ] In preview, set `SURFACE_COMPOSER_VERSION=grammar-v3` and begin with `SURFACE_GRAMMAR_V3_ROLLOUT_PERCENT=100`; confirm plan-v2 fallback is automatic and bounded.
- [ ] After preview and human usefulness acceptance, ramp production by stable hashing at 10%, 50%, and 100%, reviewing quality, fallback, latency, accessibility, and safe trace counts at each stage.
- [ ] Exercise immediate rollback by restoring `SURFACE_COMPOSER_VERSION=plan-v2`; confirm no client, schema, or data migration is required.

## Production environment

- [ ] `GEMINI_API_KEY` is configured server-side and restricted to the required Gemini service.
- [ ] `GOOGLE_MAPS_API_KEY` is configured server-side with Google Geocoding and Weather API restrictions.
- [ ] Google Maps billing, quotas, usage alerts, and billing alerts are configured.
- [ ] `CONTEXT_ENCRYPTION_SECRET` is randomly generated, at least 32 characters, and stored as a sensitive production value.
- [ ] A complete Upstash REST pair (`UPSTASH_REDIS_REST_*` or Vercel-managed `KV_REST_API_*`) is configured; production is not relying on process-local rate-limit state.
- [ ] `ALLOWED_ORIGINS` contains only exact intended origins.
- [ ] `ALLOW_DEMO_FIXTURES` is false or unset.
- [ ] `SURFACE_COMPOSER_VERSION` is independently reviewed for preview and production; unknown values fail configuration validation.
- [ ] Vercel preview and production environment scopes are reviewed independently.
- [ ] Gemini retrieval and composition still set `store: false`.
- [ ] Provider keys, prompt bodies, coordinates, provider steps, and context tokens are absent from logs.

## Deploy and smoke test

- [ ] Deploy the verified build to a Vercel preview with `SURFACE_COMPOSER_VERSION=plan-v2` and record the immutable preview URL.
- [ ] Record explicit human approval for all nine live preview recipes before changing production.
- [ ] Deploy the verified build with `vercel --prod` and record the immutable deployment URL.
- [ ] Set production to `SURFACE_COMPOSER_VERSION=plan-v2` only after preview acceptance, then redeploy so the immutable deployment contains the reviewed configuration.
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
- [ ] Confirm the production inspector identifies the selected recipe and compiler result without exposing model reasoning.
- [ ] Exercise rollback by restoring `SURFACE_COMPOSER_VERSION=spec-v1` in the correct environment scope; keep this flag until the rollout has demonstrated stability.

## Portfolio release

- [ ] Capture a real screenshot from the verified custom-domain deployment; do not use concept art.
- [ ] Add Agent UI Lab first in Featured Work with both live-demo and public-source links.
- [ ] Add the case study without changing unrelated portfolio content or documentation.
- [ ] Publish only performance, accessibility, reliability, or evaluation metrics measured from the finished production system.
- [ ] Build and test the portfolio at desktop and mobile sizes.
- [ ] Deploy the portfolio and verify its Agent UI Lab demo, source, image, and case-study links in production.
