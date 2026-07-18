# Phase 4: Curated — Research

**Researched:** 2026-07-18  
**Scope:** minimal offline personalization over Lamplighter's existing seeded updates

## Recommendation

Implement Curated entirely in the browser from the already generated `demoSeed`:

- commit a small, fixed-size, L2-normalized embedding and a hand-reviewed civic topic list for each update;
- keep one versioned, local-only personalization value containing qualified record interactions, Chat-derived topic tags, manually selected topics, and timestamps;
- score only `coverageRecords(seed, coverageId)`, then reuse the existing row and evidence panel;
- use native `localStorage`, array math, and deterministic fixture validation. Add no package, vector database, server route, provider call, account, or client database.

The committed seed contains at most 20 records. A simple `Array<number>` dot product is both the clearest and the smallest correct cosine implementation here. It stays offline and makes the screen-recording path reproducible without a key or network.

## Binding boundaries

- Candidates are the selected coverage's existing evidence-backed records only. The Curated code must call the same `coverageRecords()` boundary that Recent and Chat already use.
- A browser profile must not contain a raw Chat question. A Chat signal persists only normalized civic topic tags and its timestamp.
- A Recent signal is persisted only once the selected row has remained open for 10 seconds. No duration, scroll position, or repeated timer samples are retained.
- A copied-citation signal may retain the cited update ID and timestamp; an opened-row signal may retain the update ID and timestamp. Both IDs are already public, seed-scoped record IDs.
- Chat question > copied citation > qualified Recent open is an explicit scoring weight, not an inferred political preference.
- No source expansion, document/transcript search, or RAG is part of Curated. Full-document PDF/transcript RAG for Chat is explicitly out of scope.
- Explanations are deterministic and describe only matching topic, highest contributing action, and recency. They must not describe a person, ideology, demographic, or political leaning.

## Existing seams

| Seam | Current behavior | Phase 4 use |
| --- | --- | --- |
| `coverageRecords()` in `src/App.tsx` | Enforces configured coverage and newest-first sorting | The only Curated candidate selector; rank its returned records, never `demoSeed.records` directly. |
| `selectedId` / `detailPanel` | Recent rows and Chat citations open the same exact-quote citation panel | Curated rows set the same selection state; no second provenance UI. |
| Recent row `onClick` | Selects a record immediately | Start/cancel one 10-second qualification timer keyed by selected Recent record. Persist one `recent` event only after it completes. |
| Copy-citation button | Copies a stored citation | On successful clipboard write, persist one `citation` event for the selected record. Do not count failures. |
| `submitQuestion()` | Holds raw text transiently and appends visible Chat history | Derive known civic topic tags before disposing of the local ranking input; write only `{ kind: "chat", topics, at }` to Curated storage. Existing visible Chat history remains unchanged. |
| `validStoredThreads()` | Safely parses a versioned local-storage value | Follow this validation/fail-closed pattern for a distinct Curated storage key. |
| `data/seed-records.json` → `scripts/seed.mjs` → `src/demo-seed.ts` | Generates the browser-safe offline corpus | Carry small precomputed personalization metadata through this deterministic seed path. |
| `scripts/validate-seed.mjs` | Checks fixture/SQLite/generated-seed agreement | Extend it (or add one focused Node `assert` check) to reject bad vectors/topics and prove ranking/reset invariants. |

## Minimal data shape

Keep the new data alongside the existing generated browser records; it is metadata for ranking public update records, not raw source text.

```ts
type CuratedSignal =
  | { kind: "chat"; topics: string[]; at: string }
  | { kind: "citation" | "recent"; recordId: string; at: string };

type CuratedState = {
  version: 1;
  signals: CuratedSignal[];
  topics: string[];
};

// Added to each browser-safe seeded record.
type CuratedRecordFields = {
  topics: string[];
  embedding: number[];
};
```

Use one fixed dimension for every record (eight dimensions is ample for this 12-record demo), finite numeric values only, and require a nonzero L2 norm. Normalize vectors during seed validation, rather than mutating a committed fixture at runtime. The fixture can also carry the compact lookup needed to convert known civic topic tags into same-dimension vectors; alternatively, use each matching record vector when forming a topic profile. Do not introduce a generic embedding-provider interface until a real rebuild workflow needs one.

Topic IDs should be lowercase, trimmed, deduplicated civic labels (for example `housing`, `environment`, `budget`, `education`, `technology`, `government-operations`). The UI may accept a short custom topic, normalize it with the same rule, and retain it locally. Unknown custom topics simply have no matching seeded update; they must not trigger a network/model request or fabricate a relevance claim.

## Ranking approach

1. Start with the selected coverage's eligible records.
2. Build a local profile from the persisted signals:
   - Chat-topic overlap weight **3**;
   - citation-record/topic overlap weight **2**;
   - qualified Recent-record/topic overlap weight **1**;
   - manual topic overlap is an explicit positive preference, separate from activity.
3. For record-backed signals, form a weighted mean of their precomputed embeddings and calculate cosine similarity against each candidate. For Chat-only signals, use matching known topic vectors (or matching tagged records) without storing question text.
4. Add a modest deterministic recency term from `publishedAt`; its only job is stable tie-breaking among otherwise relevant eligible updates.
5. Sort by score descending, then newest-first and record ID. With no usable profile, skip scoring and retain the existing newest-first order as the labeled starter view.

The precise constants are less important than their testable ordering. Keep score components available in memory solely to render the required `Why this` line; do not persist scores, event counts, or a behavioral timeline.

For a candidate's explanation, select the strongest applicable topic, the strongest contributing action type (`recent Chat question`, `copied citation`, or `opened update`), and a simple recency phrase derived from the public update date. If no contribution applies, the item belongs to the starter view and should say so plainly. This meets the transparency requirement without model-written copy.

## Storage, reset, and privacy

- Use a new local-storage key such as `lamplighter-curated-v1`, independent from `lamplighter-chat-v1`.
- Validate every parsed value: exact version, ISO timestamps, permitted signal kinds, known seed IDs for record signals, string/topic length caps, and deduplication. Invalid state becomes an empty profile rather than being repaired or fetched.
- Deduplicate repeated signals by `(kind, recordId/topics, timestamp bucket)` or persist only the latest equivalent event. The candidate corpus is tiny; retention is until reset, but a bounded cap is prudent to prevent accidental unbounded browser storage.
- Reset must delete/replace only the Curated key after native confirmation, clear the in-memory profile and manual topics, retain the current Chat thread key, show a success status, and immediately return to the coverage's newest-first starter view.
- A short UI note should say personalization is local to this browser and can be reset. Do not display raw questions, event counts, timestamps, profiles, or a behavioral event log.

## Validation plan

Add one small Node `assert` script or extend the existing deterministic checks to cover the non-trivial logic:

1. Reject a missing, non-finite, dimension-mismatched, zero-length, or non-normalized embedding; require topics to be normalized and present for every eligible seeded record.
2. Assert Curated candidates for `indy`, `indiana`, and `federal` are only the same configured coverage as `coverageRecords()`.
3. Assert cosine score behavior with small fixture vectors: a Chat topic outranks an otherwise equivalent copied citation, which outranks a qualified Recent signal; recency resolves ties deterministically.
4. Assert a blank/invalid state returns newest-first starter order.
5. Assert raw Chat text cannot be serialized into Curated state, and reset yields empty signals/topics while leaving a supplied Chat-thread object untouched.
6. Run the existing contract, seed, Recent, Chat, build, and diff checks after the new curated check.

## Risks and decisions for planning

| Risk | Minimal mitigation |
| --- | --- |
| Precomputed vectors appear opaque | Commit them with the seed, validate exact size/norm, and make ranking explanations depend on visible tags/actions/recency rather than unexplained model prose. |
| Semantic quality is weak on a 12-record demo | Keep a small human-reviewed civic tag set alongside the vectors; semantic cosine only orders the safe corpus, never retrieves new material. |
| A Chat question has no civic-topic match | Store an empty tag set/timestamp or no effective ranking contribution; keep the Chat answer behavior unchanged and do not infer a topic. |
| Ten-second timer leaks across navigation/selection | Cancel it on selection, coverage, tab, or unmount changes; persist at most one qualified event. |
| Browser storage is altered manually | Parse defensively and fail to an empty profile; never trust stored IDs outside the active seed/coverage. |
| SQLite duplication adds deadline risk | Do not add a vector table or migration in this phase. The committed fixture-to-browser seed projection is sufficient for this offline, client-local ranking feature. |

## Planning recommendation

Plan three small increments:

1. Add and validate curated seed metadata plus pure local ranking/storage helpers and their Node assertions.
2. Instrument the existing Recent, citation-copy, and Chat submit seams with the minimal local signals, without changing Chat history or server boundaries.
3. Replace the unavailable Curated nav with the ranked feed, topic chips/add field, deterministic explanations, confirmation reset, and shared evidence panel; then run the complete check suite.

Do not plan embedding generation, a provider setting, vector persistence service, full-document retrieval, or an Account screen. They do not improve the required demo path.

