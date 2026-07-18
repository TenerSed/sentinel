---
phase: 03-grounded-chat
plan: "02"
subsystem: ui
tags: [react, typescript, grounded-chat, evidence, offline-demo]
requires:
  - phase: 03-grounded-chat
    provides: server-derived six-record packets and answer validation
provides:
  - browser-safe grounded answer and thread contracts
  - seven deterministic, packet-bound bundled chat prompts
  - offline preset regression coverage
affects: [03-03, grounded-chat]
tech-stack:
  added: []
  patterns: [record-ID-only answer citations, exact normalized preset matching]
key-files:
  created: [src/demo-chat.ts]
  modified: [src/types.ts, scripts/chat-contract-check.mjs]
key-decisions:
  - "Bundled answers use the same answer-block shape as live responses and are always labeled Bundled demo answer."
  - "Preset lookup is normalized but exact, coverage-scoped, and never answers candidate-position requests."
patterns-established:
  - "Persist/render only answer text and issued evidence IDs; resolve source details from the active packet."
requirements-completed: [ASK-01, ASK-03, ASK-05]
coverage:
  - id: D1
    description: Browser-safe grounded-answer, provider-status, and local-thread contracts.
    requirement: ASK-01
    verification:
      - kind: integration
        ref: npm run build
        status: pass
    human_judgment: false
  - id: D2
    description: Seven location-aware bundled answers with only current-packet evidence IDs.
    requirement: ASK-03
    verification:
      - kind: integration
        ref: npm run validate:chat
        status: pass
    human_judgment: false
  - id: D3
    description: Exact preset lookup refuses arbitrary, cross-location, and candidate-position requests.
    requirement: ASK-05
    verification:
      - kind: unit
        ref: scripts/chat-contract-check.mjs#bundled lookup refuses arbitrary, cross-location, and candidate-position questions
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-18
status: complete
---

# Phase 3 Plan 02 Summary

**Grounded Chat now has safe browser contracts and seven deterministic, citation-bound demo answers.**

## Accomplishments

- Added shared answer, provider-status, and local-thread types that store only issued evidence IDs.
- Added seven exact, location-aware bundled questions spanning Indianapolis, Indiana, and U.S. federal records.
- Extended the offline chat check to validate every preset against its six-record packet and reject unsupported lookup paths.

## Task Commits

1. **Task 1: Define browser-safe grounded-answer and local-thread contracts** — `a6c953b`
2. **Task 2: Author packet-bound bundled demo questions and answers** — `2806f8b`

## Files Created/Modified

- `src/types.ts` — common grounded answer, provider, and local-thread contracts.
- `src/demo-chat.ts` — static exact-match bundled presets with evidence IDs only.
- `scripts/chat-contract-check.mjs` — no-network preset and refusal regression checks.

## Decisions Made

- Used exact normalized matching instead of fuzzy local answering so off-topic questions refuse.
- Kept provider labels and raw evidence out of preset data and local-thread contracts.

## Deviations from Plan

None — plan executed as specified.

## Verification

Passed: `npm run validate:chat`, `npm run build`, and `git diff --check`.

## Next Phase Readiness

Plan 03-03 can render bundled and live envelopes through one citation-ID-only contract, using the existing evidence panel.

---
*Phase: 03-grounded-chat*
*Completed: 2026-07-18*
