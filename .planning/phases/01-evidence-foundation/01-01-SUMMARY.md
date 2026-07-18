---
phase: 01-evidence-foundation
plan: "01"
subsystem: database
tags: [sqlite, better-sqlite3, provenance, validation]
requires: []
provides:
  - SQLite evidence schema with foreign-keyed source, coverage, and provenance records
  - Node-only provenance validation and parameterized location projections
  - Browser-safe evidence inspector read-model types
affects: [01-02, 01-03, source-coverage, chat]
tech-stack:
  added: [better-sqlite3, @types/better-sqlite3]
  patterns: ["Validate provenance before projection", "Keep SQLite in Node scripts and browser models type-only"]
key-files:
  created: [scripts/evidence-contract.mjs, scripts/evidence-contract-check.mjs, scripts/validate-seed.mjs]
  modified: [package.json, package-lock.json, src/types.ts]
key-decisions:
  - "Use direct SQLite DDL and prepared parameters rather than an ORM."
  - "Require exactly one page or timestamp locator for every displayable evidence row."
patterns-established:
  - "Location reads pass through projectEvidenceForLocation(database, locationId)."
  - "The Vite client receives only DemoSeed presentation fields."
requirements-completed: [FOUND-02, FOUND-04, FOUND-05]
coverage:
  - id: D1
    description: "Foreign-keyed SQLite schema covers locations, sources, documents, evidence, updates, claims, activity, and chat turns."
    requirement: FOUND-02
    verification:
      - kind: unit
        ref: npm run validate:contract
        status: pass
    human_judgment: false
  - id: D2
    description: "Invalid provenance and cross-location source records are rejected before projection."
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: npm run validate:contract
        status: pass
    human_judgment: false
  - id: D3
    description: "The missing-seed validator fails loudly without fetching or rebuilding data."
    requirement: FOUND-05
    verification:
      - kind: other
        ref: node scripts/validate-seed.mjs --expect-missing
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-07-18
status: complete
---

# Phase 1 Plan 01: Evidence Contract Summary

**SQLite provenance validation and source-scoped projections now gate the browser-safe evidence model.**

## Accomplishments

- Added the approved Node SQLite binding and its types.
- Created the schema, evidence validation helpers, integrity checks, and parameterized location projection.
- Added executable checks for provenance failures, inherited coverage, denied cross-location access, and a loud missing-seed diagnostic.

## Task Commits

1. **Task 1: Verify and add SQLite binding** — `4f09354`
2. **Task 2: Define provenance-first schema and browser-safe seed contract** — `343c7ec`

## Files Created/Modified

- `scripts/evidence-contract.mjs` — schema, validator, inserts, and location projection.
- `scripts/evidence-contract-check.mjs` — executable contract check.
- `scripts/validate-seed.mjs` — read-only seed validator.
- `src/types.ts` — browser-safe seed, evidence, locator, and location types.
- `package.json` — SQLite dependency and validation scripts.

## Decisions Made

- Kept SQLite entirely in Node `.mjs` scripts; the Vite client receives no database, secret, provider, or raw-text type.
- Used explicit source-location and location-coverage relations so location scope is enforced in SQL rather than fixture labels.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Removed a non-schema URL field from evidence inserts.**
   - The contract check exposed the attempted insert immediately; `insertEvidence` now validates the document URL then inserts only evidence-table fields.
   - Verified with `npm run validate:contract`.

**Total deviations:** 1 auto-fixed. No scope expansion.

## Verification

- `npm ls better-sqlite3 @types/better-sqlite3` — passed.
- `npm run validate:contract` — passed.
- `node scripts/validate-seed.mjs --expect-missing` — passed; printed the expected missing-seed diagnostic.

## Next Phase Readiness

Plan 01-02 can now seed genuine public records through the shared schema and emit the static `DemoSeed` projection. The full Vite build remains for Plan 01-03, which replaces the pre-existing placeholder UI types and data path.
