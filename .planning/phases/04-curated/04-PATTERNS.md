# Phase 4: Curated — Codebase Patterns

**Mapped:** 2026-07-18  
**Purpose:** exact seams for the smallest offline Curated implementation

## Existing boundaries to preserve

| Boundary | Existing implementation | Phase 4 rule |
| --- | --- | --- |
| Browser corpus | `data/seed-records.json` → `scripts/seed.mjs` → `src/demo-seed.ts` | Add curated metadata at this projection only. Do not add a SQLite vector table, provider, API route, or document retrieval. `data/lamplighter.db` need not change. |
| Eligible candidates | `coverageRecords(seed, coverageId)` in `src/App.tsx` filters configured coverage and sorts newest-first | Curated must rank this exact return value, never all `demoSeed.records`; blank state keeps this order. |
| Provenance display | `selectedId`, `selected`, and `detailPanel` are shared by Recent and Chat | Curated row clicks only call the existing selection path. No second detail/citation component. |
| Chat persistence | `validStoredThreads()` and `lamplighter-chat-v1` are fail-closed and retain visible raw questions for the Chat feature | Curated uses a separate versioned key and must never import/copy `ChatThreads` or persist a raw question. Reset must not modify this key. |
| Evidence trust | `validateSeed()`, `validateFixture()`, `validateEvidence()`, and `assertSeedMatchesDatabase()` make invalid demo data fail loudly | Curated fixture metadata gets the same validation; keep raw text and hashes out of the browser projection. |

## Data and validation seams — Plan 1

### Files to touch

- `src/types.ts`: add the browser-safe per-record curated fields (`topics`, `embedding`) to `EvidenceRecord`, plus small `CuratedSignal`/`CuratedState` contracts if the pure helper needs them.
- `data/seed-records.json`: hand-add normalized civic topic tags and a fixed-dimensional, L2-normalized numeric vector to every record. This is committed demo metadata, not an embedding service output.
- `scripts/seed.mjs`: validate topic/vector fixture fields; when `writeDemoSeed()` projects database rows, merge those fields from the fixture by record ID before writing `src/demo-seed.ts`. The existing SQLite projection does not contain these fields.
- `src/demo-seed.ts`: regenerate with `npm run seed`; commit the generated browser-safe metadata. No DB migration is required.
- `scripts/validate-seed.mjs`: assert generated topics/vectors match the fixture as well as the existing evidence fields.
- `src/curated.ts` (new): one pure browser-safe module for normalization, fail-closed local-state parsing, cosine/ranking, transient Chat-topic extraction, and deterministic `Why this` data. A new helper is warranted because it must be checked outside React and keeps `App.tsx` from duplicating score/storage logic.
- `scripts/curated-check.mjs` (new) and `package.json`: one Node `assert` check for vector validity, candidate scoping, priority (`chat > citation > recent`), deterministic recency/tie fallback, invalid/blank starter state, raw-question exclusion, and reset isolation. Keep it package-free.

### Established implementation details

- `writeDemoSeed()` already builds a `byId` map and strips locator columns. Create a fixture-by-ID map there and add only `{ topics, embedding }` to the matching projected record.
- `validateFixture()` already loops every record. Validate lowercase trimmed/deduplicated topic IDs, a single fixed finite vector dimension, nonzero norm, and normalized vectors there. This makes malformed curated metadata stop `npm run seed` before it reaches the browser.
- `assertSeedMatchesDatabase()` intentionally compares relational evidence fields. It should additionally compare generated curated fields against `fixture.records`; SQLite cannot be the authority for metadata deliberately kept out of the DB.
- Use a normal array dot product for cosine. At this corpus size the profile and candidates are in memory; no dependency or vector index has a useful role.
- The helper's selected candidates must be passed in by `App.tsx`; it must not receive a seed and perform its own broad query.
- Topic extraction examines only transient submitted text against the fixed known topic vocabulary and returns tags. It never returns or stores the input string. Unknown/custom topics are allowed as manual chips but contribute no fabricated match.

## Interaction seams — Plan 2

### Files to touch

- `src/App.tsx`: load/store a distinct `lamplighter-curated-v1` state using the same guarded `localStorage` effect style as Chat; call helper functions to record signals and derive the ranked list.

### Existing hooks and exact behavior

- **Recent open:** the Recent row `onClick` currently sets `selectedId`. Only this explicit click starts a single 10-second timer for that record. On timer completion, add one `recent` signal. Cancel on another selected record, coverage/tab change, unmount, or re-render cleanup. The implicit first `records[0]` detail panel must never count as an open.
- **Citation copy:** the current detail action treats `navigator.clipboard.writeText()` as fire-and-forget. Record a `citation` signal only after its promise resolves; retain the current error UI on rejection or a missing clipboard API. This applies to the currently selected provenance record, including when it was selected from Chat or Curated.
- **Chat submit:** `submitQuestion()` owns transient `text` before it appends a visible `ChatTurn`. Derive and store only matching civic topic tags plus timestamp there, before any early bundled/live/insufficient return. Do not alter the `question` field in existing Chat threads, send profile data to `/api/chat`, or use prior raw thread text.
- **Storage:** copy the `validStoredThreads()` defensive pattern, but only accept version 1, valid ISO timestamps, permitted signal kinds, normalized topic strings, and record IDs found in the current seed. Invalid state becomes an empty Curated profile. Bound/deduplicate signals in the helper to keep localStorage cheap without displaying event history.
- **Reset:** reset replaces/removes only the Curated key and in-memory Curated state; it does not call `setThreads` or touch `lamplighter-chat-v1`.

## Curated screen seams — Plan 3

### Files to touch

- `src/App.tsx`: extend `ActiveTab` with `curated`; replace the unavailable navbar button with an active tab; add a Curated branch that feeds existing `record-row` markup from ranked eligible records and retains `detailPanel` alongside it.
- `src/styles.css`: add only compact Curated controls, `Why this`, local-only note, confirmation/status styling, and the existing responsive-grid treatment. Reuse `evidence-grid`, `record-list`, `record-row`, `panel-heading`, `detail-panel`, `future-message`, and bottom-nav styles.

### UI pattern to follow

- Header copy uses the same `activeTab` conditional as Recent/Chat: Curated is local, offline personalization over source-backed updates.
- Add selectable topic chips and one `Add topic` input inside the Curated list/header. Normalize through the helper; duplicate or empty input changes nothing.
- Render **every** ranked candidate. `coverageRecords()` already supplies the direct and inherited configured coverage; ranking does not widen it.
- Reuse each row's exact quote, provenance labels, selected state, and click handler. Add one deterministic `Why this` line that names only matching topic, strongest contributing action (`recent Chat question`, `copied citation`, `opened update`), and public-record recency. Never call a model or characterize a user's politics.
- Blank/invalid/reset profile uses newest-first records with a visible “starter view” label. It must not invent an explanation from absent signals.
- Use the native `window.confirm` before reset (no modal dependency), then set a short success `role=status` message. The visible privacy note says personalization stays in this browser and can be reset; it shows no action counts, history, timestamps, profile, or raw text.

## Three-plan dependency order

1. **Offline ranking foundation:** enrich and validate committed seed metadata; create pure ranking/storage helper and assert-based curated contract. This supplies all Phase 4 behavior without a retrieval stack.
2. **Signal capture:** wire existing Recent, citation-copy, and Chat-submit actions to the isolated local profile and prove timing/success-only boundaries. Depends on Plan 1 helpers/contracts.
3. **Curated tab:** render ranking, topic controls, plain explanations, and reset through existing list/detail UI. Depends on Plans 1–2.

## Explicit non-seams

- `server/app.mjs`, `server/chat.mjs`, `/api/chat`, OpenAI/Anthropic/Gemini configuration, and `data/lamplighter.db` do not need changes for Curated.
- No full-document PDF/transcript RAG for Chat, document semantic search, source expansion, embedding rebuild, provider abstraction, vector database, Account tab, account, or server-side behavioral storage belongs in this phase.

*Ponytail ceiling: local O(records × signals) scoring is intentional for the committed 12–20-record demo; add indexed/server retrieval only after the curated corpus materially grows.*
