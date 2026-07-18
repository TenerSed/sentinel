# Phase 1: Evidence Foundation - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish Lamplighter’s offline, source-scoped evidence foundation: a deterministic seeded data path, an evidence-first SQLite contract, and a minimal Vite-backed inspector that proves the seed can be read without keys or network access. This phase does not build the final Recent, Curated, or Chat product views.

</domain>

<decisions>
## Implementation Decisions

### Seed corpus

- **D-01:** Ship roughly 12–20 hand-verified, genuine public updates spanning Indianapolis, Indiana, and U.S. federal coverage.
- **D-02:** Prioritize recent updates; include one older item only when it is necessary to demonstrate a timestamped video citation.
- **D-03:** Government records are the primary source of truth. News may appear only as clearly labeled reporting and never establishes a legal status or vote by itself.

### Evidence contract

- **D-04:** A factual claim is excluded unless it has an exact supporting quote of 25 words or fewer, a canonical public-source URL, and a reliable page or video timestamp locator when applicable.
- **D-05:** Omit claims from sources without a reliable page or timestamp rather than publish a vague citation.
- **D-06:** Model-extracted facts are provisional until application code validates their quote, locator, source, and selected-location boundary.
- **D-07:** When reporting differs from a primary record, preserve citations and label the item as reporting; do not declare a conflict without explicit evidence.

### Demo operation

- **D-08:** `npm run demo` starts a minimal Vite/React evidence inspector backed by the committed seed—not only a database or CLI check.
- **D-09:** Demo mode defaults to the committed seed. Live ingestion and model calls are opt-in so a missing key or network never breaks the judge path.
- **D-10:** Keep the Phase 1 shell intentionally plain: seed/status and evidence inspection only. Final feed navigation belongs to Phase 2.
- **D-11:** Missing or invalid seed data must fail loudly; the app must not silently fetch or rebuild it.

### Raw evidence and pushed baseline

- **D-12:** Commit the exact selected public PDFs and transcript text where reasonably sized and permitted; preserve the source URL, retrieval date, and content hash regardless.
- **D-13:** The repository may use up to 500 MB for raw evidence. Bundle normalized transcript text, timestamps, and URLs—not video files.
- **D-14:** Treat the merged `src/data.ts` signals as placeholder UI data. Replace or hide each item until it is backed by the evidence contract; placeholders must not appear as verified civic facts.
- **D-15:** Retain the merged Vite/React application as the implementation baseline. Do not convert the UI wholesale during Phase 1; preserve the server-only secret boundary when optional provider code is later introduced.

### the agent's Discretion

- Choose the smallest SQLite schema, migration approach, local Node/server boundary, and test tooling that satisfy the locked evidence and no-key demo rules.
- Decide the exact public source registry entries after validating their terms, content size, locator quality, and recency.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product contract

- `.planning/PROJECT.md` — product scope, security boundary, source policy, and deadline constraints.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `FOUND-01` through `FOUND-05` and `LOC-03`.
- `.planning/ROADMAP.md` — Phase 1 goal and observable success criteria.
- `.planning/research/SUMMARY.md` — evidence-first architecture, SQLite FTS guidance, source handling, and risk register.

### Merged application baseline

- `package.json` — current Vite/React scripts and installed dependency baseline.
- `src/App.tsx` — existing static signal inspector; visual shell only, not a source of civic facts.
- `src/data.ts` — placeholder signal records that must be replaced or hidden until evidence-backed.
- `src/types.ts` — current signal/citation shape to adapt or retire behind the new evidence model.
- `src/styles.css` — existing styling baseline; final product styling is out of Phase 1 scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/App.tsx`: selectable signal cards and a detail/citation panel can serve as the temporary evidence-inspector shell once their placeholder data is removed.
- `src/types.ts`: `Citation` and `Signal` types identify the current UI seam; Phase 1 may replace them with evidence-first types.

### Established Patterns

- Vite + React + TypeScript is the merged application baseline.
- Static imports from `src/data.ts` currently feed the UI; this is explicitly not acceptable for verified civic content after Phase 1.

### Integration Points

- `src/main.tsx` mounts `App`; the Phase 1 inspector connects here.
- `package.json` must gain a deterministic `demo` command and the minimal scripts needed to validate or seed the bundled database.

</code_context>

<specifics>
## Specific Ideas

- The judge path must use genuine public material and work without an API key or network.
- The user’s source-of-truth rule is absolute: no evidence, no displayed factual claim.
- The raw-evidence allowance is intentionally generous (up to 500 MB) to preserve reproducibility, but video files are never bundled.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 1.

</deferred>

---

*Phase: 1-Evidence Foundation*
*Context gathered: 2026-07-18*
