# Phase 4: Curated - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Create Lamplighter’s Curated tab: rank only the active coverage’s already eligible evidence-backed updates from local anonymous activity, manual civic-topic preferences, precomputed embeddings, and recency. Explain each rank plainly and let users reset local personalization without touching Chat history. Do not add source expansion, full-document RAG, accounts, or political profiling.

</domain>

<decisions>
## Implementation Decisions

### Local signals and retention

- **D-01:** Rank from local actions with this hierarchy: submitted Chat question > copied citation > opened Recent row.
- **D-02:** Keep local personalization signals until the user resets them.
- **D-03:** For ranking, retain only Chat-derived civic topic tags and timestamps—never raw Chat question text.
- **D-04:** Count a Recent-row signal only after it remains open for 10 seconds; do not track reading duration beyond this threshold.

### Semantic ranking

- **D-05:** Use semantic retrieval for Curated with committed precomputed embeddings and local cosine ranking; rebuilding embeddings is optional and server-side.
- **D-06:** Build the local profile from activity-linked updates, without political labels, demographic inference, or ideology inference.
- **D-07:** Let users edit a small civic-topic set, prefilled from local activity.
- **D-08:** With no profile, show the newest eligible evidence-backed updates as a labeled starter view.
- **D-09:** Embeddings rank only already surfaced update records. Full PDF/transcript semantic retrieval remains out of scope and cannot feed Chat directly.

### Curated experience

- **D-10:** Reuse the Recent row and evidence-panel layout, adding compact topic controls and a `Why this` line for each item.
- **D-11:** `Why this` names matching topic, contributing action type, and recency; never use a model-written explanation.
- **D-12:** Edit topics inside Curated with selectable chips and an `Add topic` field.
- **D-13:** Show every eligible update in ranked order, rather than truncating the list.

### Reset and transparency

- **D-14:** Reset clears local ranking signals and manually selected topics, but preserves local Chat history.
- **D-15:** Use a confirmation dialog before reset and show a clear success message afterward.
- **D-16:** Show only per-item `Why this` lines and a short local-only ranking note; do not expose event history or action counts.
- **D-17:** After reset, return to the selected coverage’s newest-first starter view.

### the agent's Discretion

- Choose the smallest safe embedding storage/serialization shape, vector dimension, deterministic score formula, topic normalization, and fallback ordering.
- Reuse current browser-safe seed, coverage, evidence-panel, local-storage, and custom-CSS patterns rather than introduce a client database or UI framework.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and trust constraints

- `.planning/PROJECT.md` — core civic source-of-truth and no-key demo boundaries.
- `.planning/REQUIREMENTS.md` — Phase 4 requirements `CUR-01` through `CUR-04`.
- `.planning/ROADMAP.md` — Phase 4 goal and success criteria.
- `.planning/phases/02-source-coverage-and-recent/02-CONTEXT.md` — configured coverage, evidence-panel, reporting, and Recent rules.
- `.planning/phases/02-source-coverage-and-recent/02-VERIFICATION.md` — verified location/evidence and no-expansion boundaries.
- `.planning/phases/03-grounded-chat/03-CONTEXT.md` — local Chat threads and closed-packet decisions that Curated must not weaken.
- `.planning/phases/03-grounded-chat/03-VERIFICATION.md` — verified client/server citation and source-expansion safeguards.

### Existing implementation seams

- `src/App.tsx` — active coverage, Recent/Chat tabs, evidence panel, copy action, 10-second row interaction seam, and local storage.
- `src/types.ts` — browser-safe evidence, coverage, grounded answer, provider, and thread contracts.
- `src/demo-seed.ts` — committed browser-safe eligible record projection.
- `src/demo-chat.ts` — bundled Chat presets and topic-bearing civic questions.
- `scripts/evidence-contract.mjs` and `scripts/seed.mjs` — deterministic fixture/SQLite/browser-projection boundary.
- `src/styles.css` — existing responsive custom-CSS shell and bottom navigation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `coverageRecords()` in `src/App.tsx` already enforces active configured coverage and newest-first order.
- The Recent buttons, `detailPanel`, and Chat citation callback already surface provenance through a shared panel.
- `ChatThreads` persistence in `src/App.tsx` demonstrates validated local-storage read/write by coverage ID.
- `demoSeed.records` offers the only browser-safe candidate corpus for local Curated ranking.

### Established Patterns

- The browser only consumes generated static seed data; no SQLite, raw text, provider call, or secret belongs in the client.
- Invalid seed data fails loud; UI does not broaden coverage, fetch alternate sources, or invent facts.
- Reporting remains an explicit source kind and never establishes legal/policy status.

### Integration Points

- Turn the existing unavailable Curated bottom-nav action into the Curated view without breaking Recent or Chat.
- Record only the locked local signals and topics in a separately validated local-storage key.
- Add optional precomputed embeddings to the deterministic seed contract and validate them before local cosine scoring.

</code_context>

<specifics>
## Specific Ideas

- A user asked about RAG; use semantic ranking only over surfaced updates in this phase, not raw document retrieval.
- The ranking must be legible enough for a short demo voice-over: local interest, source-backed updates, and an explicit reset.

</specifics>

<deferred>
## Deferred Ideas

- Thread-based provider conversational memory beyond the existing locally visible threads.
- Explicit evidence expansion/search across configured government sources and clearly labeled reporting.
- An Account/settings tab or user accounts; topic controls stay in Curated for this phase.

</deferred>

---

*Phase: 4-Curated*
*Context gathered: 2026-07-18*
