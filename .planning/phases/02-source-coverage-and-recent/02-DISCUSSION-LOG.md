# Phase 2: Source Coverage and Recent - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-07-18
**Areas discussed:** Coverage selection, Recent feed, manual import, navigation and evidence

## Decisions

- Indianapolis expands to Indiana and federal coverage; direct Indiana/federal selections stay exact.
- Recent is newest-first, unclustered, and shows one short exact quote per evidence-backed row.
- Reporting stays in the feed with an explicit label.
- Import is one allowlisted command with URL-then-hash dedupe, separate import storage, non-renderable drafts, and partial-failure non-zero exit.
- Recent is the active bottom tab; Curated and Chat show a coming-later message.
- Evidence opens in a responsive side/stacked panel; public links use stored canonical URLs.

## Deferred Ideas

- In-app draft review list for incomplete imports.
