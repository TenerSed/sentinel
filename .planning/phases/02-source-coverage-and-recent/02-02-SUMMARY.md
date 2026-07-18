---
phase: 02-source-coverage-and-recent
plan: "02"
subsystem: database
tags: [sqlite, vite, react, evidence, validation]
requires:
  - phase: 01-evidence-foundation
    provides: SQLite evidence contract and browser-safe seed
provides:
  - Registry-derived coverage and update types in the browser seed
  - Deterministic Recent scope/order validation
affects: [recent-feed, curated-feed, grounded-chat]
tech-stack:
  added: []
  patterns: [SQLite-backed browser projection validated against the committed fixture]
key-files:
  created: [scripts/recent-scope-check.mjs]
  modified: [scripts/seed.mjs, scripts/validate-seed.mjs, scripts/evidence-contract.mjs, src/demo-seed.ts, src/types.ts]
key-decisions:
  - "Indianapolis expands through the explicit registry; direct Indiana and federal selections remain exact."
  - "Update types are fixture-backed SQLite data, never inferred in the browser."
patterns-established:
  - "Validate generated seed parity with SQLite before the offline demo starts."
requirements-completed: [LOC-01, LOC-02, RECN-01, RECN-02, RECN-04]
coverage:
  - id: D1
    description: Registry-derived coverage and deterministic Recent ordering.
    requirement: LOC-02
    verification:
      - kind: integration
        ref: npm run validate:recent
        status: pass
    human_judgment: false
  - id: D2
    description: Browser-safe cited updates with validated categories and reporting type.
    requirement: RECN-01
    verification:
      - kind: integration
        ref: npm run validate:seed
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-07-18
status: complete
---

# Phase 2 Plan 02: Scoped Recent Seed Summary

**SQLite-derived coverage and update types now produce a deterministic, browser-safe Recent read model.**

## Accomplishments

- Added exact Indianapolis, Indiana, and federal coverage relationships plus validated update categories.
- Added SQLite update-type constraints and carried only citation-ready fields into the generated Vite seed.
- Added seed parity and Recent scope/order regression checks.

## Task Commits

1. **Task 1: Add a narrow generated coverage contract and scoped Recent check** — `faaf4ee` (feat)

## Verification

- `npm run seed` — passed
- `npm run validate:seed` — passed
- `npm run validate:recent` — passed
- `npm run build` — passed
- Invalid coverage, update type, and corrupted generated-record data were rejected; the seed was regenerated afterward.

## Deviations from Plan

None.

## Next Phase Readiness

The Recent UI can filter the static seed from its configured coverage without duplicating location rules or exposing raw evidence.
