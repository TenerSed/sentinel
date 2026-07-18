---
phase: 01-evidence-foundation
verified: 2026-07-18T03:35:00-04:00
status: passed
score: 5/5
reverification: true
gaps: []
---

# Phase 1: Evidence Foundation — Final Re-verification

## Verdict: PASSED

Commit `1a09c5b` resolves both earlier blockers. The fixture now contains 12 records across Indianapolis, Indiana, and U.S. federal coverage, including government records, a timestamped public meeting transcript, and a clearly typed reporting item. Every fixture record is rejected unless its exact quote is found in a hash-checked bundled evidence asset.

## Roadmap success criteria

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `npm run demo` starts the core experience from committed SQLite data with no API key or network access. | VERIFIED | `package.json` runs `node scripts/validate-seed.mjs && vite`; the client imports only `src/demo-seed.ts`. No client fetch, model, or secret access is present. |
| 2 | SQLite stores locations, sources, documents, evidence, updates, claims, activity, and chat turns with foreign-key integrity. | VERIFIED | `scripts/evidence-contract.mjs` defines all eight families with foreign keys enabled. `npm run validate:seed` passes its integrity check. |
| 3 | Seeded public records cover Indianapolis, Indiana, and federal levels, including both page and timestamp evidence. | VERIFIED | The committed fixture and database contain 12 records, three locations, page evidence, and timestamp evidence. |
| 4 | Every stored/displayable claim resolves to quoted evidence with a URL and applicable page or timestamp locator. | VERIFIED | `validateFixture()` validates quote, HTTPS URL, locator, raw-file hash, and exact quote presence before seeding. PDF-page quotes use hash-checked page transcriptions; timestamped VTT quotes are checked only within the stored timestamp interval. |
| 5 | Database and provider/model modules are server-only and location/source checks occur before retrieval or rendering. | VERIFIED | SQLite is used only in Node scripts. `projectEvidenceForLocation()` binds the requested location and joins configured coverage plus source membership before generating the browser projection. |

## Evidence audit

- All 12 records pass `assertEvidenceQuoteInRawAsset()`.
- The reporting record is a `reporting` source, visibly labelled as such in `src/App.tsx`, and cites the bundled Indiana Newsdesk VTT from `06:44` to `06:51`.
- The exact reporting quote is present across the VTT cues within the registered `404–411` second interval.
- The fixture requires all three source kinds: `government_record`, `video_transcript`, and `reporting`.
- The database has 10 government-record updates, 1 transcript update, and 1 reporting update.

## Checks run

```text
npm run validate:contract  # passed
npm run validate:seed      # passed
npm run build              # passed
```

Direct fixture validation additionally exercised every raw quote against its configured evidence asset. `git status --short` shows only this verification artifact pending.

## Note

The inspector exposes page/timestamp locators and opens the stored canonical public URL. Constructing deep PDF-page/video-time links is deferred; it is not required for Phase 1's offline evidence-foundation success criteria.
