# Phase 2: Source Coverage and Recent - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Lamplighter's real location-aware Recent experience: users select configured coverage, read cited civic updates, inspect evidence, and maintainers can run a manual allowlisted import. Curated ranking and grounded Chat remain later phases.

</domain>

<decisions>
## Implementation Decisions

### Coverage selection

- **D-01:** Selecting Indianapolis expands to its configured Indianapolis, Indiana, and U.S. federal coverage.
- **D-02:** Selecting Indiana or U.S. federal directly shows only that exact level.
- **D-03:** Use a compact location control at the top of Recent.
- **D-04:** When the selected coverage has no eligible updates, show an explicit selected-jurisdiction empty state; do not broaden coverage or substitute seed-wide content.

### Recent feed

- **D-05:** Order updates newest-first by source publication/update time with a stable tie-break.
- **D-06:** Render one evidence-backed update per row; do not add clustering in this phase.
- **D-07:** Each row shows jurisdiction, source type, date, title, and one short exact quote.
- **D-08:** Reporting uses the same row format with a clear `Reporting` label and never implies legal or policy status.

### Manual import

- **D-09:** Provide one allowlisted manual command that processes all configured sources.
- **D-10:** Continue processing other sources when one fetch or parse fails, report each failed source, and exit non-zero.
- **D-11:** Deduplicate by canonical URL first, then content hash when URLs differ.
- **D-12:** Write imports to a separate local import database; never mutate the committed demo seed automatically.
- **D-13:** Retain incomplete imported records as non-renderable drafts for CLI/SQLite inspection only. They must never appear in Recent.
- **D-14:** Imported records must pass the Phase 1 source, quote, locator, source-membership, and location-boundary checks before becoming feed-eligible.

### Navigation and evidence

- **D-15:** Bottom navigation shows Recent as active plus Curated and Chat as unavailable future tabs.
- **D-16:** Tapping an unavailable tab shows a short coming-later message and stays on Recent.
- **D-17:** Opening a Recent row uses a right-side evidence panel on desktop and a stacked panel on narrow screens.
- **D-18:** `Open public record` opens the stored canonical URL without constructing PDF page or video timestamp jump parameters.

### the agent's Discretion

- Choose the smallest allowlisted source registry and import storage shape that reuse Phase 1's validation contract.
- Choose exact empty/error/loading copy and responsive visual details within the Phase 1 manual-CSS design language.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and requirements

- `.planning/PROJECT.md` — product scope, security boundary, source policy, and deadline constraints.
- `.planning/REQUIREMENTS.md` — Phase 2 requirements `LOC-01`, `LOC-02`, `LOC-04`, `RECN-01` through `RECN-04`, and `PROD-01`.
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria.
- `.planning/phases/01-evidence-foundation/01-VERIFICATION.md` — verified evidence-boundary behaviors that Phase 2 must preserve.

### Existing evidence and UI seam

- `.planning/phases/01-evidence-foundation/01-CONTEXT.md` — locked source-of-truth, no-key demo, reporting, and Vite-baseline decisions.
- `scripts/evidence-contract.mjs` — shared source/provenance and location-scoping contract.
- `scripts/validate-seed.mjs` — existing seed validation boundary.
- `src/demo-seed.ts` and `src/types.ts` — browser-safe evidence projection contract.
- `src/App.tsx` and `src/styles.css` — current manual-CSS inspector to evolve into Recent.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `scripts/evidence-contract.mjs`: parameterized source/location projection and provenance validation.
- `src/App.tsx`: selection state and evidence-detail interaction.
- `src/styles.css`: responsive two-column evidence panel pattern and accessible custom CSS.

### Established Patterns

- Vite/React consumes a generated browser-safe seed projection; it never imports SQLite or provider modules.
- The committed `data/lamplighter.db` is the no-key/no-network demo source of truth.
- Reporting is an explicit source kind, not a primary-record claim.

### Integration Points

- Extend the browser projection and React state for selected coverage and Recent rows.
- Add manual import logic outside the browser bundle and reuse the existing validation contract before eligibility.

</code_context>

<specifics>
## Specific Ideas

- Preserve the calm, high-contrast evidence-first visual language; fast and legible beats decorative.
- A recent date is informational only, never proof of legal or policy status.

</specifics>

<deferred>
## Deferred Ideas

- In-app review list for incomplete imported drafts — keep drafts inspectable only through CLI/SQLite in Phase 2.
- Story clustering — deferred beyond Phase 2.
- Curated ranking and grounded Chat — explicitly later roadmap phases.

</deferred>

---

*Phase: 2-Source Coverage and Recent*
*Context gathered: 2026-07-18*
