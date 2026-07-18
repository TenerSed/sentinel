---
phase: 03-grounded-chat
plan: "01"
subsystem: api
tags: [sqlite, vite, openai, grounded-chat, testing]
requires:
  - phase: 02-source-coverage-and-recent
    provides: configured coverage and cited SQLite records
provides:
  - server-derived six-record evidence packets
  - transient-only provider fallback with local answer validation
  - offline chat trust-boundary regression command
affects: [03-02, 03-03, grounded-chat]
tech-stack:
  added: [openai@6.48.0]
  patterns: [server-owned packet construction, application-issued citation IDs]
key-files:
  created: [server/chat.mjs, server/app.mjs, scripts/chat-contract-check.mjs]
  modified: [scripts/evidence-contract.mjs, scripts/seed.mjs, package.json]
key-decisions:
  - "OpenAI is the audited primary SDK; Anthropic and Gemini use native fetch."
  - "Invalid provider output is terminal and never reaches a fallback or client."
patterns-established:
  - "Build packets from read-only SQLite, never browser evidence."
  - "Validate every answer block and issued evidence ID locally."
requirements-completed: [ASK-02, ASK-03, ASK-05]
coverage:
  - id: D1
    description: Closed SQLite evidence packet and grounded-answer validator
    requirement: ASK-02
    verification:
      - kind: integration
        ref: npm run validate:chat
        status: pass
    human_judgment: false
  - id: D2
    description: Server-only provider fallback and safe status endpoint
    requirement: ASK-03
    verification:
      - kind: integration
        ref: npm run validate:chat
        status: pass
    human_judgment: false
  - id: D3
    description: Candidate-position preflight and citation-boundary regression suite
    requirement: ASK-05
    verification:
      - kind: unit
        ref: scripts/chat-contract-check.mjs
        status: pass
    human_judgment: false
completed: 2026-07-18
status: complete
---

# Phase 3 Plan 01 Summary

**A Node/Vite chat boundary now derives a six-record SQLite packet, validates every cited answer block, and uses transient-only server-side provider fallback.**

## Accomplishments

- Audited and pinned the official OpenAI SDK; documented native-fetch fallbacks and opt-outs.
- Added `evidenceKind` to the trusted fixture/database/browser projection; all existing records remain `civic_update`.
- Added `/api/chat` and `/api/chat/status`, with no browser authority over evidence, providers, or keys.
- Added 18 no-network contract cases for grounding, coverage, candidate preflight, and fallback behavior.

## Task Commits

1. Task 1: provider audit — `be34587`
2. Task 2: server boundary — `9c11c2c`
3. Task 3: regression suite — `41abc9b`

## Verification

Passed: `npm run validate:chat`, `validate:contract`, `validate:seed`, `validate:recent`, `validate:import`, and `npm run build`.

## Deviations

`insertEvidence` defaults direct low-level callers to `civic_update` so the existing evidence-contract regression remains valid; the fixture itself still requires an explicit checked evidence kind.

## Next Phase Readiness

Plan 03-02 can add browser-safe bundled answers and UI types against the packet/validator contract without importing server code into `src/`.
