# Generative UI Grammar v3

Grammar v3 replaces recipe-shaped presentation contracts with a constrained composition grammar. It does not allow generated React, HTML, CSS, JavaScript, arbitrary component names, URLs, actions, or event handlers.

## Trust boundary

Gemini may select evidence-backed content, reading order, grouping, semantic prominence, and one of the bounded layout primitives. The server still owns retrieval, normalized measurements, immutable sources, source URLs, evidence indexes, requested-coverage rules, plan validation, trusted compilation, budgets, repair, and fallback. React owns rendering, local interaction state, responsive behavior, typography, color, motion, and accessibility.

The public request and NDJSON stream stay compatible. A successful v3 surface uses the A2UI v0.9.1 catalog `https://lab.jalbright.dev/catalogs/editorial/v3`. Plan v2 continues to use `editorial/v2` and remains the deterministic fallback and immediate rollback target.

## Plan contract

`GenerativeSurfacePlanV3` contains:

- `version: "v3"`
- `kind: weather | comparison | research`
- `density: brief | balanced | detailed`
- `emphasis: answer | evidence | exploration`
- optional `archetypeHint`, used only for telemetry and fallback selection
- bounded evidence-referencing content nodes
- a flat adjacency-list layout graph with a `rootId`

Recipe IDs never impose component membership, variants, or order in v3. Existing recipes remain advisory archetypes and continue to define plan-v2 fallback behavior.

## Layout catalog

The v3 catalog adds `Stack`, `Grid`, `Split`, `Section`, `Card`, `Rail`, `Tabs`, `Disclosure`, and `Divider`. Props are closed semantic enums: compact/regular/generous gaps, primary/supporting/reference roles, neutral/accent/caution tones, adaptive/two/three columns, start/center/stretch alignment, and lead/standard/quiet prominence.

Tabs and disclosures are read-only local React interactions. Tabs implement arrow, Home, and End keyboard navigation with tab and tabpanel semantics. A primary answer, weather alert, or SourceList cannot be placed inside either interaction. Interactive containers cannot nest. SourceList is compiler-owned as the single final child in logical DOM order.

## Extended toolkit

`SURFACE_GRAMMAR_V3_TOOLKIT=extended` gives Gemini a larger vocabulary. The validator, compiler, and renderer always accept it, so recorded fixtures and rollback do not depend on the flag. The default `base` toolkit keeps the original schema and instructions byte-for-byte. Shared token lists live in `shared/layout-tokens.ts`.

**Layout primitives**

- `accordion`: 2–5 labeled panels with an optional default-open index. It is interactive, so it follows the tab and disclosure rules: no primary content, alerts, or sources inside, and no nesting. Headers are buttons with `aria-expanded` and support arrow, Home, and End focus movement.
- `scroller`: a labeled, focusable horizontal region of 2–8 peers. Snapping is disabled under reduced motion.
- `columns`: one span (`third`, `half`, `two-thirds`, `full`) per child on a 12-track grid. It collapses to one column on narrow surfaces.
- `aside`: exactly two children, main content first and supporting content second, with the side column on the `start` or `end` side. The side column is sticky on wide surfaces. Primary content must sit in the main child, and DOM order always keeps main content first.

**Style tokens**

- Tones add `positive` and `info`.
- Cards add `variant` (`outlined`, `filled`, `elevated`), an optional `icon`, and an optional `label`.
- Sections add `width` (`full`, `narrow`) and an optional `icon`.
- Grids add `four` columns, stacks add `end` alignment, and dividers add `style` (`line`, `space`, `ornament`).
- Icons come from a closed set of twelve renderer-drawn glyphs.

**Insight modules** are model-authored, bounded, cited, and never primary:

- `callout`
- `badges`
- `facts`: key figures with an optional trend and sparkline
- `proscons`
- `ranked`
- `meter`: the value must fall within its min/max range
- `quote`: research surfaces only

Weather surfaces and weather-backed comparisons accept only `callout` and `badges`. Their text passes the same numeric grounding rules as other weather narrative. Every insight source ID must be issued and covered by the final sources module.

**Chart variants**

- Authored charts add `area`, `stacked-bar` (two or more non-negative series), `donut` (one non-negative series, at most eight slices), and `range` (exactly two series, low then high).
- Weather-backed charts add `area`.
- Shape rules live in `shared/chart-shape.ts` and are enforced by both the plan validator and the render contract.
- Every variant keeps the visible data table.

`npm run eval:ui:semantic` includes two recorded extended compositions, QR02 and QC04. `eval:ui:browser` checks them for overflow, serious axe violations, and accordion interaction at all five grammar widths. Reference screenshots for these compositions are not committed yet.

## Validation and compilation

Content and layout validate independently before trusted compilation. The validator rejects:

- duplicate or overlapping IDs
- missing roots, cycles, unreachable nodes, shared children, or unknown references
- content rendered zero or multiple times
- sources inside the generated layout
- a primary answer that is not first in depth-first reading order
- primary answers or alerts inside local interactions
- nested tabs or disclosures
- more than six levels or sixty compiled A2UI nodes
- invalid semantic tokens or unsafe labels
- missing requested charts, timelines, locations, units, hours, days, ranges, criteria, evidence sides, or citations
- chart/table misalignment and source-ID closure failures

The current domain compiler remains authoritative for normalized weather values, forecast indexes, activity windows, comparison alignment, research polarity, change-manifest units, and server-issued sources. The v3 compiler then resolves the validated content roots into the validated layout and emits deterministic A2UI IDs. Model-authored bounded headings and connective prose pass the same text, source, semantic, and content-budget policies as plan v2.

Content and layout complexity are separate:

| Density | Content nodes | Layout nodes | Prose | Lead prose |
| --- | ---: | ---: | ---: | ---: |
| Brief | 6 | 4 | 700 | 280 |
| Balanced | 9 | 6 | 1,400 | 480 |
| Detailed | 12 | 8 | 2,200 | 700 |

## Composition failure behavior

Gemini receives a compact JSON Schema narrowed to the detected domain, issued source IDs, weather manifest indexes, and research change manifest where applicable. Shape acceptance is never treated as semantic acceptance. Server validation and compilation may request one complete replacement plan. A second invalid output uses the existing validated deterministic plan-v2 fallback without another provider call. If that fallback cannot be validated, the outer request returns the existing bounded safe response.

## Evaluation

V3 acceptance is invariant-based. Exact recipe trees and presentation-only variants are not correctness gates. Required facts, affirmative research polarity, requested coverage, chart/table alignment, citation closure, content budgets, answer-first order, source visibility, and graph integrity remain hard gates. Structural fingerprints and layout families are bounded telemetry used to detect drift.

`npm run eval:ui:semantic` includes recorded grammar-v3 compositions across weather, comparison, and research. `npm run eval:ui:live:v3` is an explicit, credentialed shadow evaluation: it composes three samples for each of the 18 recorded-evidence cases without showing them to users. The full run requires 54/54 final quality-valid, 54/54 invariant-conformant, at least 52/54 valid first-pass, and zero fallback uses.

## Rollout and rollback

Set `SURFACE_COMPOSER_VERSION=grammar-v3` only in an approved preview first. `SURFACE_GRAMMAR_V3_ROLLOUT_PERCENT` is an integer from 0 through 100. Stable prompt hashing assigns supported requests to grammar v3 or plan v2, allowing 10%, 50%, and 100% ramps without random per-request churn. Unsupported domains continue through the existing bounded path.

Before any production ramp, complete the live shadow gate, responsive checks at 320, 390, 768, 1024, and 1440 pixels, axe and reduced-motion checks, latency review, and human usefulness review. Roll back immediately by setting `SURFACE_COMPOSER_VERSION=plan-v2`; no schema migration or client rollback is required.

External actions remain out of scope. A2UI actions and client/server action RPC require a separate threat model and release plan.
