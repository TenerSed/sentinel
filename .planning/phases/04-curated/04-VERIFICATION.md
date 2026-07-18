# Phase 4: Curated Verification

**Verified:** 2026-07-18  
**Verdict:** passed

## Requirement coverage

| Requirement | Result | Evidence |
| --- | --- | --- |
| CUR-01 | Passed | `App` passes only `coverageRecords()` for the active coverage into `rankCuratedRecords()`, renders every returned record, and reuses the shared evidence panel. |
| CUR-02 | Passed | The committed, normalized update embeddings are ranked locally with cosine/topic/recency data; the offline check proves Chat topic signals outrank citation signals, which outrank qualified Recent opens, and a blank profile retains newest-first order. |
| CUR-03 | Passed | Curated state accepts only versioned topic tags, public record IDs, and ISO timestamps. Raw Chat-question-shaped state is rejected; explanations are deterministic topic/action/recency text and the screen states that personalization is local. |
| CUR-04 | Passed | Native confirmation resets only `lamplighter-curated-v1`; the regression check proves the Chat key/data remains unchanged and the UI returns to starter order with a status message. |

## Boundary review

- Recent signals start only from explicit Recent-row clicks and require ten uninterrupted seconds; coverage, tab, selection, and unmount clean up the timer.
- Citation signals are appended only after `navigator.clipboard.writeText()` resolves. Failed or unavailable clipboard access records nothing.
- Submitted Chat text is reduced to known civic-topic tags before Curated storage; no raw question, thread, quote, URL, provider/model data, score, or event timeline is serialized there.
- Phase changes add no RAG, document/transcript retrieval, source expansion, API route, provider, database migration, account surface, or dependency. Curated ranks the supplied browser-safe corpus only.

## Automated verification

Passed as one no-network suite:

```text
npm run validate:contract
npm run validate:seed
npm run validate:recent
npm run validate:chat
npm run validate:curated
npm run validate:import
npm run build
git diff --check
```

`validate:curated` exercises the production Curated helper via TypeScript transpilation and covers fixture/vector metadata, coverage boundaries, signal priority, deterministic fallback, malformed state rejection, raw-question rejection, and reset isolation.

## Human-facing checks

The implementation provides the planned keyboard-native buttons/forms, focus styling, 44px control targets, native confirmation, and responsive wrapping. A final browser recording/UAT pass remains appropriate during Phase 5 for the ten-second timer, clipboard permission behavior, narrow layout, and the Recent → Curated → evidence panel demo path.
