---
phase: 01-evidence-foundation
plan: "03"
subsystem: ui
tags: [vite, react, evidence, offline-demo]
requires:
  - plan: "01-02"
    provides: Generated, validated browser-safe DemoSeed backed by committed SQLite evidence
provides:
  - Offline evidence inspector that renders only generated validated records
  - Validate-before-Vite judge path with no key, network, fetch, or model call
affects: [phase-02, source-coverage, recent-feed]
tech-stack:
  added: []
  patterns: [Static DemoSeed import with local shape validation, no-network evidence inspection]
key-files:
  created: []
  modified: [package.json, src/App.tsx, src/styles.css, src/types.ts]
key-decisions:
  - "Removed the placeholder signal dataset instead of downgrading it into evidence."
  - "Kept manual CSS and removed remote font loading so the offline demo makes no browser network request."
patterns-established:
  - "Evidence UI renders source-grounded fields only after local seed validation."
requirements-completed: [FOUND-01, FOUND-03, FOUND-04, FOUND-05]
coverage:
  - id: D1
    description: "The no-key demo validates the committed SQLite seed before Vite starts."
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "npm run validate:seed && npm run demo -- --host 127.0.0.1"
        status: pass
    human_judgment: false
  - id: D2
    description: "The inspector presents only bundled evidence with exact quotes, locators, reporting labels, and stored public-record links."
    requirement: FOUND-04
    verification:
      - kind: other
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "Visual and interaction behavior requires browser review."
  - id: D3
    description: "A missing seed stops the demo before Vite can start."
    requirement: FOUND-05
    verification:
      - kind: integration
        ref: "temporary data/lamplighter.db removal followed by npm run demo"
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-07-18
status: complete
---

# Phase 1 Plan 03: Evidence Inspector Summary

**A no-network Vite inspector now exposes only validated, citation-bearing public records from the committed seed.**

## Accomplishments

- Replaced the merged Sentinel dashboard and placeholder signals with a static `DemoSeed` evidence inspector.
- Added `npm run demo`, which validates SQLite before Vite starts and fails loudly if the committed seed is missing or invalid.
- Implemented ready, loading, error, empty, populated, reporting, citation-copy, responsive, and keyboard-visible states using custom CSS only.

## Task Commits

1. **Task 1: Wire the seed-gated Vite evidence inspector** — `5fd0299`
2. **Task 2: Apply the approved accessible custom-CSS inspector contract** — `fac8772`

## Files Created/Modified

- `package.json` — adds the validate-before-start `demo` command.
- `src/App.tsx` — renders locally validated bundled evidence and citation controls.
- `src/styles.css` — responsive, accessible inspector styling with no remote font import.
- `src/types.ts` — removes retired placeholder signal types.
- `src/data.ts` — removed unverified placeholder civic data.

## Decisions Made

- The browser only imports the generated `demoSeed` module and validates its narrow shape again before rendering.
- The public-record link preserves the stored canonical URL; the UI never manufactures a destination or fetches evidence.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 2 - Missing critical behavior] Added the clipboard-unavailable fallback.**
   - The inline fallback now appears when the platform does not expose `navigator.clipboard`, as well as when copying rejects.

2. **[Rule 2 - No-network demo boundary] Removed the remote Google Fonts stylesheet.**
   - The committed demo no longer makes a font request before rendering its local evidence.

**Total deviations:** 2 auto-fixed. No scope expansion.

## Verification

- `npm run validate:seed` — passed.
- `npm run build` — passed.
- `npm run demo -- --host 127.0.0.1` — passed after seed validation.
- Temporarily removed `data/lamplighter.db`; `npm run demo` failed loudly before Vite started, then the original database was restored.

## Next Phase Readiness

Phase 2 can build source coverage and the Recent feed on the generated evidence model. The Phase 1 judge path remains keyless and offline.

---
*Phase: 01-evidence-foundation*
*Completed: 2026-07-18*
