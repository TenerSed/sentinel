# Project State: Lamplighter

## Current Position

**Current phase:** Phase 1 — Evidence Foundation  
**Status:** Ready to plan  
**Last updated:** 2026-07-18

## Roadmap Progress

| Phase | Status |
|---|---|
| 1. Evidence Foundation | Pending |
| 2. Source Coverage and Recent | Pending |
| 3. Grounded Chat | Pending |
| 4. Curated | Pending |
| 5. Submission Hardening | Pending |

## Next Action

Plan Phase 1: establish the offline SQLite evidence contract and deterministic seed path before building product views.

## Decisions Carried Forward

- Initial coverage is Indianapolis, Indiana, and U.S. federal sources through a configuration-driven registry.
- The no-key, offline SQLite seed is the required demo path; live ingestion and model calls are optional server-side paths.
- Application code, not the model, enforces source, location, retrieval, citation, and refusal boundaries.
- The primary user flow is Recent → evidence → grounded Chat; Curated only reorders the same eligible corpus.

## Known Risks

- Exact source URLs, transcript provenance, PDF page locators, and video timestamps need manual verification before recording.
- Confirm the available GPT-5.6 model ID and structured-output call shape before enabling optional live calls.
- Keep deployment in a single Node process compatible with `better-sqlite3`.

---
*State initialized: 2026-07-18*
