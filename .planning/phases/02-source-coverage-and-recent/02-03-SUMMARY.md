---
phase: 02-source-coverage-and-recent
plan: "03"
subsystem: ui
tags: [react, vite, evidence, accessibility, offline-demo]
requires:
  - phase: 02-source-coverage-and-recent
    provides: Registry-derived coverage and ordered browser-safe records
provides:
  - Offline location-aware Recent feed with provenance detail
  - Accessible unavailable-state bottom navigation
affects: [grounded-chat, curated-feed, submission-demo]
tech-stack:
  added: []
  patterns: [static validated seed projection, canonical citation links only]
key-files:
  created: []
  modified: [src/App.tsx, src/styles.css]
key-decisions:
  - "Recent filters only the static generated coverage projection; it never fetches or broadens coverage."
  - "Curated and Chat are explicit unavailable controls until their dedicated phases."
patterns-established:
  - "Render stored evidence fields verbatim and use its unchanged canonical URL for the public-record action."
requirements-completed: [LOC-01, LOC-02, RECN-01, RECN-02, RECN-03, RECN-04, PROD-01]
coverage:
  - id: D1
    description: Location-aware, newest-first Recent rows derived from the validated seed.
    requirement: LOC-01
    verification:
      - kind: integration
        ref: npm run validate:seed && npm run validate:recent && npm run build
        status: pass
    human_judgment: false
  - id: D2
    description: Responsive evidence panel, citation copy fallback, and unavailable future tabs.
    requirement: RECN-03
    verification:
      - kind: integration
        ref: npm run build
        status: pass
    human_judgment: true
    rationale: Browser interaction and narrow-screen layout need visual UAT.
completed: 2026-07-18
status: complete
---

# Phase 2 Plan 03: Recent UI Summary

**Offline Recent feed with scoped public-record evidence and an accessible evidence panel.**

## Accomplishments

- Added Indianapolis, Indiana, and U.S. federal coverage selection backed solely by the generated seed registry.
- Replaced the inspector metrics with newest-first update rows and provenance-only details, including clear reporting labels.
- Added responsive evidence layout and fixed Recent/Curated/Chat navigation without pretending later features exist.

## Task Commits

1. **Task 1: Implement the offline Recent interaction contract** — `3a6e9b5` (feat)
2. **Task 2: Apply the approved responsive Recent and bottom-navigation design** — `ec2b703` (style)

## Verification

- `npm run validate:seed` — passed
- `npm run validate:recent` — passed
- `npm run build` — passed
- `npm run demo -- --host 127.0.0.1` — passed; Vite served the validated no-key demo.

## Deviations from Plan

None.

## Next Phase Readiness

The app now has a stable evidence-selection surface that Curated and Chat can reuse without changing the client-side source boundary.

---
*Phase: 02-source-coverage-and-recent*
*Completed: 2026-07-18*
