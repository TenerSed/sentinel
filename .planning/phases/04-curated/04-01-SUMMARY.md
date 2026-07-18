---
phase: 04-curated
plan: "01"
subsystem: personalization
tags: [typescript, localstorage, cosine, seed-validation]
requires:
  - phase: 03-grounded-chat
    provides: browser-safe seeded evidence records and closed coverage boundaries
provides:
  - validated per-record civic topics and fixed normalized vectors in the browser seed
  - fail-closed local Curated profile and caller-scoped deterministic ranker
  - offline regression coverage for metadata, privacy, reset, and coverage boundaries
affects: [04-02-signal-capture, 04-03-curated-ui]
tech-stack:
  added: []
  patterns: [fixture-to-browser ranking metadata, package-free local cosine, fail-closed local state]
key-files:
  created: [src/curated.ts, scripts/curated-check.mjs]
  modified: [data/seed-records.json, scripts/seed.mjs, scripts/validate-seed.mjs, src/demo-seed.ts, src/types.ts, package.json]
key-decisions:
  - "Keep vectors committed beside fixture records and out of SQLite because Curated only ranks the existing offline browser projection."
  - "Reject malformed Curated storage wholesale instead of repairing it, and retain only topic tags, public record IDs, and timestamps."
patterns-established:
  - "Curated helpers accept caller-scoped EvidenceRecord arrays and never import the seed or query broader data."
  - "Use the Chat contract's in-process TypeScript transpilation pattern to test production browser helpers without a browser or network."
requirements-completed: [CUR-01, CUR-02, CUR-03, CUR-04]
coverage:
  - id: D1
    description: Validated civic-topic and L2-normalized vector metadata reaches every browser-safe seeded update.
    requirement: CUR-01
    verification:
      - kind: integration
        ref: npm run seed && npm run validate:seed
        status: pass
      - kind: unit
        ref: scripts/curated-check.mjs#fixture metadata is finite, normalized, and projected exactly
        status: pass
    human_judgment: false
  - id: D2
    description: Curated ranking stays within caller-provided coverage and ranks signals deterministically.
    requirement: CUR-02
    verification:
      - kind: unit
        ref: scripts/curated-check.mjs#coverage candidates are the existing configured projection only
        status: pass
      - kind: unit
        ref: scripts/curated-check.mjs#Chat topics outrank citation signals, which outrank Recent opens
        status: pass
    human_judgment: false
  - id: D3
    description: Curated storage rejects raw questions, foreign IDs, malformed timestamps, versions, and oversized input.
    requirement: CUR-03
    verification:
      - kind: unit
        ref: scripts/curated-check.mjs#parser fails closed on raw questions, foreign IDs, timestamps, versions, and oversized state
        status: pass
    human_judgment: false
  - id: D4
    description: Reset is isolated from Chat history and unknown topics do not fabricate candidates.
    requirement: CUR-04
    verification:
      - kind: unit
        ref: scripts/curated-check.mjs#topic extraction retains tags only and reset leaves Chat data untouched
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-07-18
status: complete
---

# Phase 4 Plan 1: Curated Ranking Foundation Summary

**Committed civic-topic vectors and a deterministic local ranker personalize only the existing evidence-backed browser corpus.**

## Accomplishments

- Added hand-reviewed civic topics and normalized eight-dimensional vectors to all 12 bundled updates, validated before seed generation.
- Added a browser-only, fail-closed Curated state contract with bounded signals, local cosine ranking, topic extraction, explanations, and reset.
- Added `npm run validate:curated`, exercising the production TypeScript helper without a network, API key, provider, or browser.

## Task Commits

1. **Task 1: Add verified, browser-safe curated metadata** — `c91f054`
2. **Task 2: Implement pure local ranking and storage helper** — `89946eb`
3. **Task 3: Lock invariants in an offline assertion check** — `b304594`

## Files Created/Modified

- `src/curated.ts` — caller-scoped ranker and local storage-state helpers.
- `scripts/curated-check.mjs` — production-helper regression checks through `transpileModule`.
- `data/seed-records.json`, `scripts/seed.mjs`, `scripts/validate-seed.mjs`, `src/demo-seed.ts` — validated browser ranking metadata.
- `src/types.ts`, `package.json` — Curated contracts and validation command.

## Decisions Made

- Used committed metadata plus array dot products; no vector database, embedding provider, server path, or RAG is warranted for the 12-record offline demo.
- Preserved SQLite as the authority for evidence while the fixture remains authoritative for browser-only ranking metadata.

## Deviations from Plan

None — plan executed as written.

## Issues Encountered

- TypeScript initially required explicit narrowing of parsed `unknown` timestamp/topic fields; fixed before the Task 2 build checkpoint.

## Verification

Passed: `npm run seed`, `npm run validate:seed`, `npm run validate:curated`, `npm run validate:contract`, `npm run validate:recent`, `npm run validate:chat`, and `npm run build`.

## Next Phase Readiness

Plan 2 can record qualified Recent, citation, and Chat topic signals through `src/curated.ts`; Plan 3 can pass `coverageRecords()` into `rankCuratedRecords()`.

---
*Phase: 04-curated*
*Completed: 2026-07-18*
