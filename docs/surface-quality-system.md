# Surface Quality System specification

## Objective

Make Weather, Comparison, and Research answers feel purpose-designed for the request while preserving the trusted-component boundary. Gemini selects a semantic recipe, density, emphasis, ordered modules, and grounded copy. Server-owned code validates that plan, resolves evidence references, and compiles the final A2UI surface.

The primary audience is hiring teams evaluating the lab as a portfolio project. Success means prompt intent produces a predictable but visibly distinct hierarchy, with safe inspector evidence showing how the presentation was selected.

## Contracts

- The model-facing `SurfacePlan` is a discriminated union with `kind`, `recipeId`, `density`, `emphasis`, and ordered capability-specific modules.
- Recipes are `weather.snapshot`, `weather.decision`, `weather.outlook`, `comparison.verdict`, `comparison.scorecard`, `comparison.trend`, `research.brief`, `research.timeline`, and `research.claims`.
- Weather measurements are copied from normalized server evidence. Search-backed claims retain server-owned source IDs. Plans never contain URLs, CSS, HTML, JavaScript, or arbitrary component names.
- A deterministic compiler converts `SurfacePlan` to the trusted `SurfaceSpec`; the existing compiler converts that spec to A2UI v0.9.1 messages.
- One repair attempt is allowed. A second failure compiles a deterministic domain recipe from available evidence.
- `POST /api/agent` remains request-compatible. Its trace may add safe recipe, density, emphasis, quality-check, repair-category, and compiler metadata.

## Visual grammar

- Add a trusted `SurfaceFrame` root with enum-only recipe, density, and emphasis props.
- Bump the custom catalog ID to `https://lab.jalbright.dev/catalogs/editorial/v2`; retain A2UI v0.9.1.
- Let recipe compilers use `Split`, `Rail`, `Metric`, headings, bands, and dividers across supported domains.
- Add semantic variants for weather heroes and forecasts, comparison summaries and charts, research leads, and evidence lists.
- Implement responsive behavior with application-owned CSS and container queries. Compact surfaces may shorten supporting prose but must preserve requested data ranges.

## Quality benchmark

- Keep the existing 40-prompt safety suite.
- Add 18 recorded-evidence UI-quality cases, two per recipe, covering recipe fit, required facts, module ordering, density, source coverage, and content budgets.
- `npm run eval:ui` runs deterministic quality, component, accessibility, overflow, and screenshot checks.
- `npm run eval:ui:live` is opt-in and runs three composition samples per case against recorded evidence.
- Store approved screenshots for one prompt per recipe at 320, 390, 768, and 1440 pixels.

## Commands

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit and component tests: `npm run test:run`
- Safety evaluation: `npm run eval`
- UI-quality evaluation: `npm run eval:ui`
- Opt-in live evaluation: `npm run eval:ui:live`
- Browser tests: `npm run test:e2e`
- Production build: `npm run build`

## Project structure and style

- Server planning, validation, compilation, and quality logic lives under `api/_lib` and remains independent of React.
- Shared stream and trusted component contracts live in `shared`.
- React implementations stay under `src/lib/a2ui`; shell and inspector changes stay under `src/components/shell`.
- Evaluation cases and deterministic runners stay under `src/evals`; browser coverage stays under `e2e`.
- Follow existing named exports, Zod strict schemas, immutable provider records, semantic class names, and colocated Vitest tests.

## Boundaries

- Always validate model output, evidence references, sources, catalog nodes, responsive layouts, and accessibility before release.
- Keep prompts, evidence bodies, coordinates, tokens, provider steps, and secrets out of logs and inspector output.
- Do not add new domains, external writes, accounts, permanent history, arbitrary plugins, generated code, raw style props, or an A2UI v1 migration.
- Preserve the 45-second request deadline, current rate limits, source ownership, encrypted context behavior, and safe fallbacks.

## Release criteria

- 100% valid trusted output or deterministic safe fallback; zero unsafe URLs.
- At least 95% first-pass validity across 54 opt-in live composition samples and no fallback across the 18 supported quality cases.
- Complete requested location, unit, time-range, comparison-criteria, and cited-evidence coverage.
- Every recipe is selected for a representative prompt and produces the expected structural fingerprint.
- Zero serious axe findings or horizontal overflow at 320, 390, 768, and 1440 pixels; visible focus and reduced-motion behavior remain correct.
- All nine reference surfaces receive an owner review score of at least 4/5 for relevance, hierarchy, scanability, and balance.
- Existing tests, evaluations, lint, typecheck, build, preview smoke tests, production smoke tests, and portfolio checks pass.

## Rollout

Gate the new path with `SURFACE_COMPOSER_VERSION=spec-v1|plan-v2`, defaulting to `spec-v1` until preview acceptance. Log only safe presentation enums, validation categories, counts, and timings. After all nine recipes pass preview and production smoke checks, enable `plan-v2`, retain the rollback flag, capture real desktop/mobile results, and update the portfolio only with measured claims.
