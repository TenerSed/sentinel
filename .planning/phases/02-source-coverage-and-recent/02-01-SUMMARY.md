---
phase: 02-source-coverage-and-recent
plan: "01"
subsystem: infra
tags: [sqlite, importer, provenance, validation]
requires:
  - phase: 01-evidence-foundation
    provides: offline SQLite seed and shared evidence validation
provides:
  - bounded local source importer with an inspectable HTTPS allowlist
  - separate import SQLite database that retains uncited material only as drafts
affects: [recent-feed, source-coverage]
tech-stack:
  added: []
  patterns: ["Live retrieval stays in an ignored local database and cannot alter the bundled demo seed."]
key-files:
  created: [data/import-sources.json, scripts/import-check.mjs, scripts/import.mjs]
  modified: [.gitignore, package.json]
key-decisions:
  - "Fetched content is draft-only until a later phase supplies validated quote and locator evidence."
patterns-established:
  - "Manual importers use finite HTTPS host allowlists and canonical-URL-first deduplication."
requirements-completed: [LOC-04]
coverage:
  - id: D1
    description: "Maintainer import command is limited to configured HTTPS sources and stores outcomes separately from the demo seed."
    requirement: LOC-04
    verification:
      - kind: integration
        ref: "npm run validate:import && npm run import -- --help && npm run validate:seed && npm run build"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed source is recorded while subsequent configured sources continue."
    requirement: LOC-04
    verification:
      - kind: integration
        ref: "temporary invalid allowlist endpoint run (2026-07-18)"
        status: pass
    human_judgment: false
duration: 14min
completed: 2026-07-18
status: complete
---

# Phase 2 Plan 01: Bounded Import Summary

**A finite manual importer records public-source retrieval metadata in local SQLite while keeping all unverified fetches out of the offline Recent feed.**

## Performance

- **Duration:** 14 min
- **Completed:** 2026-07-18T08:21:37Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added a five-source, HTTPS-only import allowlist tied to configured source/location membership.
- Added an offline contract check for allowlist trust boundaries, canonical URL dedupe, hash dedupe, and draft eligibility.
- Added `npm run import`, which uses an ignored `data/imports.db`, caps responses, blocks unsafe redirects, continues after failures, and never writes the bundled seed.

## Task Commits

1. **Task 1: Define the bounded source allowlist and prove import boundary behavior** — `6446bd8` (`test`)
2. **Task 2: Implement the separate, fail-noisy manual import command** — `78691fa` (`feat`)

## Files Created/Modified

- `data/import-sources.json` — finite configured source and host allowlist.
- `scripts/import-check.mjs` — no-network importer contract checks.
- `scripts/import.mjs` — bounded manual retrieval and local draft storage.
- `.gitignore` — excludes local import SQLite files.
- `package.json` — exposes validation and maintainer import commands.

## Decisions Made

- Fetched material remains non-renderable by default because this phase has no live extraction payload with an exact quote and locator.
- The importer follows only up to three validated allowlisted redirects and retains at most 1 MB per response.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification

- `npm run validate:import` — passed.
- `npm run import -- --help` — passed without opening `data/imports.db`.
- `npm run validate:seed` — passed; the bundled database remained unchanged.
- `npm run build` — passed.
- A temporary invalid configured endpoint caused a source-specific stored failure, later sources still ran, and the command exited non-zero.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The Recent UI can continue to rely solely on the committed seed; imported drafts are isolated and non-renderable.
- A later extraction phase may promote material only after validating an exact quote, locator, source membership, and location boundary.

## Self-Check: PASSED

---
*Phase: 02-source-coverage-and-recent*
*Completed: 2026-07-18*
