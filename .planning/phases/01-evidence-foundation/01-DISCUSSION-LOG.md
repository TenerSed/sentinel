# Phase 1: Evidence Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 1-Evidence Foundation
**Areas discussed:** Seed corpus, Evidence contract, Demo boundary, Raw-source handling

---

## Seed corpus

**User’s choices:** Ship 12–20 recent, hand-verified public updates across Indianapolis, Indiana, and federal coverage. Government records are primary; news is labeled contextual reporting. An older item is permitted only for video-timestamp evidence.

## Evidence contract

**User’s choices:** No source, no fact. Claims require a short exact quote, canonical URL, and reliable page/timestamp; provisional model output is locally validated; reporting differences do not become claimed conflicts without explicit proof.

## Demo boundary

**User’s choices:** `npm run demo` starts a minimal Vite/React evidence inspector from the committed seed. Live services are opt-in, and missing/invalid demo data fails loudly.

## Raw-source handling

**User’s choices:** Bundle permitted PDFs and transcript text, retain URL/retrieval/hash metadata, allow up to 500 MB of raw evidence, and never bundle video files. The merged static signals are placeholders until evidence-backed.

## the agent's Discretion

- Select the smallest schema, local server boundary, migration approach, and test tooling that enforce the decisions above.

## Deferred Ideas

None.
