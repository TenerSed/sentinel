---
phase: 02-source-coverage-and-recent
verified: 2026-07-18T08:35:00-04:00
status: passed
score: 5/5
gaps: []
---

# Phase 2: Source Coverage and Recent — Verification

## Verdict: PASSED

Phase 2 delivers the planned offline Recent path without weakening the evidence boundary. The browser reads only the validated generated seed; the maintainer importer is separately stored, bounded by a finite HTTPS allowlist, and its fetched material remains non-renderable.

## Roadmap success criteria

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Users select Indianapolis, Indiana, or U.S. federal; Indianapolis expands to state and federal coverage. | VERIFIED | `src/App.tsx` uses the generated `coverage` relationship only. `scripts/recent-scope-check.mjs` proves `indy -> indy, indiana, federal`, `indiana -> indiana`, and `federal -> federal`. |
| 2 | Recent shows scoped legislation, office-holder, and policy updates with jurisdiction, date, source type, and direct citation. | VERIFIED | `src/App.tsx` renders one ordered record button per eligible row with all fields, while `src/demo-seed.ts` retains the canonical URL, exact quote, locator, source kind, and update type. The bundled corpus includes all three update types. |
| 3 | Evidence panels show supporting quote and open the source document. | VERIFIED | Selecting a row renders only stored provenance in the detail panel and its `Open public record` anchor uses the unchanged `selected.canonicalUrl`. Page/timestamp locator text is displayed. Per locked D-18, the app deliberately does not manufacture PDF-page or video-time URL parameters. |
| 4 | Primary records and reporting are distinct, with no legal/policy-status inference. | VERIFIED | `sourceLabel` explicitly labels primary records versus `Reporting`; reporting detail adds `Reporting, not the primary record`. Rendered update labels are only descriptive classifications. |
| 5 | A maintainer can manually import allowlisted records with URL normalization, dedupe, and retrieval metadata. | VERIFIED | `scripts/import.mjs` validates registry membership and HTTPS hosts, limits bytes/redirects, normalizes URLs, hashes response bytes, records attempts in ignored `data/imports.db`, dedupes URL before hash, retains drafts only, continues failures, and exits non-zero after failures. |

## Plan must-haves and requirement coverage

| Plan | Status | Evidence |
|---|---|---|
| 02-01 / LOC-04 | VERIFIED | `data/import-sources.json`, `scripts/import.mjs`, and `scripts/import-check.mjs` meet the finite allowlist, separate-store, URL-first/hash-second dedupe, draft-only, and fail-noisy boundaries. A live `npm run import` stored five drafts in `data/imports.db`; hashes of `data/lamplighter.db` and `src/demo-seed.ts` were unchanged. |
| 02-02 / LOC-01, LOC-02, RECN-01, RECN-02, RECN-04 | VERIFIED | SQLite `location_coverage`, schema update-type constraint, generated browser projection, `validate-seed`, and `validate:recent` provide exact coverage, deterministic newest-first ordering, three update types, citation fields, and explicit reporting. |
| 02-03 / LOC-01, LOC-02, RECN-01, RECN-02, RECN-03, RECN-04, PROD-01 | VERIFIED | Recent’s native labeled selector, evidence panel, canonical action, reporting warning, copy fallback, responsive CSS, and fixed accessible three-target navigation match the locked context/UI contract. Curated and Chat are visibly unavailable rather than mocked. |

## Checks run

```text
npm run validate:contract  # passed
npm run validate:seed      # passed
npm run validate:recent    # passed
npm run validate:import    # passed
npm run import -- --help   # passed
npm run build              # passed
npm run demo -- --host 127.0.0.1  # passed; seed validated before Vite served
npm run import             # fetched all five allowlisted sources as non-renderable local drafts
```

The live import recorded canonical URL/hash/retrieval metadata in the ignored import database. It did not modify either committed demo artifact; the before/after SHA-256 values matched.

## Boundary audit

- No client-side fetch, provider/model call, secret read, raw document exposure, automatic seed rebuild, or coverage broadening is present in `src/`.
- `validateSeed()` rejects malformed locations, coverage, update/source kinds, non-HTTPS URLs, unsupported locators, and overlong quotes before UI rendering.
- `projectEvidenceForLocation()` applies configured location coverage and source-location membership before serializing browser records.
- Imported material has no path into `src/demo-seed.ts` or `data/lamplighter.db`; its only destination in the live importer is `import_drafts`.

## Notes

The live importer currently prints `imported as draft` after any successful fetch, even when its SQLite attempt row records a duplicate. This does not affect data integrity, dedupe ordering, or the Phase 2 requirements, but later maintainer polish should make that console line reflect the recorded result.
