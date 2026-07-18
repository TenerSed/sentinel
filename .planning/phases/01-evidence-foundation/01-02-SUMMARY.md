---
phase: 01-evidence-foundation
plan: "02"
subsystem: evidence-corpus
tags: [sqlite, seed, provenance, civic-records]
requires:
  - plan: "01-01"
    provides: SQLite provenance contract and location projection
provides:
  - Hand-verified public civic-record fixture across Indianapolis, Indiana, and federal coverage
  - Hash-checked raw evidence and a deterministic committed SQLite database
  - Browser-safe static DemoSeed projection generated from source-scoped SQL reads
affects: [01-03, source-coverage, chat]
key-files:
  created: [data/seed-records.json, data/lamplighter.db, scripts/seed.mjs, src/demo-seed.ts]
  modified: [scripts/validate-seed.mjs, package.json, src/types.ts]
key-decisions:
  - "Use one small, hand-verified offline corpus rather than a live ingestion fallback."
  - "Hash every committed raw asset before the database is replaced."
  - "Generate the browser model only from projectEvidenceForLocation reads."
requirements-completed: [FOUND-01, FOUND-03, FOUND-04, LOC-03]
duration: 45min
completed: 2026-07-18
status: complete
---

# Phase 1 Plan 02: Evidence Corpus Summary

**A no-key SQLite corpus now supplies 11 provenance-complete civic records with generated browser-safe evidence data.**

## Accomplishments

- Added 10 official public PDFs and a timestamped public council transcript; all records span Indianapolis, Indiana, and U.S. federal coverage.
- Added fixture validation for source/location membership, exact quotes, locators, SHA-256 hashes, and the 11–20 record range.
- Built an idempotent lock-protected seed script that writes a temporary database, atomically replaces the committed DB, and regenerates `src/demo-seed.ts` from `projectEvidenceForLocation`.

## Task Commits

1. **Task 1: Assemble the hand-verified, provenance-complete public record registry** — `a66fcd8`
2. **Task 2: Build the idempotent SQLite seed and generated browser projection** — `618a47d`

## Verification

- `node scripts/validate-seed.mjs --validate-fixtures` — passed.
- `npm run seed && npm run validate:seed` — passed twice; DB and generated module hashes were identical across runs.
- `npm run validate:contract` — passed.
- `npm run build` — passed.
- A deliberately changed raw transcript failed fixture validation, then passed again after restoration.
- Read-only projection counts: Indianapolis 12, Indiana 7, U.S. federal 4; all required schema tables exist.

## Deviations

1. **[Rule 1 - Bug] Restored legacy placeholder `Signal` types alongside the new evidence types.** The pushed Vite shell still imports them until Plan 01-03 replaces its placeholder UI; retaining the types keeps the production build green without exposing placeholder data as verified evidence.
2. **[Rule 2 - Validation] Added the fixture-validation mode to the existing seed validator.** This makes the required hash and provenance checks executable before any database write.
3. **[Rule 1 - Provenance repair] Removed the AP HTML reporting item.** Its displayed `p. 1` locator was not a real page-addressable citation; the corpus now keeps only records with verifiable page or timestamp evidence.

## Next Phase Readiness

Plan 01-03 can replace the placeholder dashboard input with `demoSeed` and render the approved offline evidence inspector. No network or API key is required for the committed database path.
