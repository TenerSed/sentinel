# Lamplighter Architecture

**Decision:** Build one Node.js Next.js App Router application backed by a bundled SQLite file. Treat SQLite as the evidence store and retrieval engine; GPT-5.6 is an extraction, ranking, and answer service behind deterministic database gates. Do not add auth, a queue, a vector database, background scheduling, or a generic connector framework for the demo.

**Confidence:** High for the demo boundary and data model; medium for live transcript/provider parsers because each public source has its own format.

## Runtime and component boundaries

```
Browser (small Client Components)
  -> Server Components / Route Handlers
       -> query + write services
            -> better-sqlite3 (seed.db / data.db)
            -> OpenAI Node SDK (only if OPENAI_API_KEY exists)
            -> allowlisted public-source fetchers (manual CLI only)
```

Use Server Components for all feed reads and evidence pages. Keep only location selection, tab state, seen events, and Chat submission as Client Components. Server Components can access databases and secrets without exposing them in browser code; a `"use client"` boundary pulls its import graph into the browser bundle, so database/OpenAI modules must be `server-only`. [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

Suggested small module layout:

| Boundary | Responsibility | Must not do |
|---|---|---|
| `lib/registry.ts` | Typed location/source registry; validates configured source IDs and allowed hosts. | Fetch arbitrary user URLs. |
| `lib/db.ts`, `lib/repository.ts` | One `better-sqlite3` connection, migrations, prepared statements, transactional writes, all retrieval queries. | Call the model or render UI. |
| `lib/ingest/*` | RSS/document/transcript adapters convert registry sources into raw records; deduplicate and persist evidence. | Accept model facts as evidence. |
| `lib/normalize.ts` | Converts stored raw text into a canonical claim/update and evidence spans. | Invent missing locators. |
| `lib/ai.ts` | GPT structured extraction, rank scoring, and grounded answer drafting. | Receive unrestricted web content or choose citations. |
| `lib/feed.ts`, `lib/chat.ts` | Deterministic orchestration: location filtering, FTS retrieval, citation validation, fallbacks. | Be imported by a Client Component. |
| `app/*` | Three views: Recent, Curated, Chat; route handlers only for mutations/live calls. | Direct SQL or secrets. |

Run every route needing SQLite with the Node runtime, not Edge. `better-sqlite3` exposes synchronous prepared statements/transactions appropriate for a local single-process demo. [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

## Configuration-driven coverage

Keep the registry in versioned TypeScript (not a database admin UI): it is reviewable, type-safe, and enough for a deadline demo. Each `Location` has `id`, `label`, `parentIds`, and `sourceIds`; each `Source` has `id`, `locationIds`, `kind` (`rss | document | transcript`), `publisher`, `baseUrl`, `feedUrl?`, `allowedHosts`, `trust` (`government | cited_news`), `topics`, and `enabled`. Initial data names only Indianapolis, Indiana, and US federal sources. A source cannot be selected by an incoming request unless its ID exists in this registry.

This enables location selection honestly: selecting Indianapolis expands its configured sources plus Indiana and federal parents. Adding a jurisdiction is a registry entry plus seeded/live source records, not an application-code branch.

## Evidence-first ingestion and normalization

### Import flow

1. A manual `npm run ingest -- --source=<registry-id>` loads only an enabled, allowlisted registry source. No scheduled fetches in v1.
2. The adapter fetches with a timeout, response-size cap, redirect host check, and content-type check. RSS supplies publication links; document/transcript adapters download the configured public item only.
3. Store the original metadata/text and a stable content hash in `documents`; unique `(source_id, canonical_url)` and hash prevent duplicates. Failed imports are retained as a status/error, not silently converted into updates.
4. Split extracted text into ordered `evidence` rows. Preserve `start_offset/end_offset`; add `page_number` for PDFs and `start_seconds/end_seconds` for transcripts when known. For video URLs, evidence links use `#t=<start_seconds>`.
5. GPT-5.6 receives document text plus evidence-row IDs and returns a strict extraction shape: summary, update type, topics, importance, and claims that each reference supplied evidence IDs. The server rejects any claim whose IDs are absent from that document or whose locator is missing.
6. Persist accepted `updates`, `claims`, and their evidence joins in one transaction; index update/document text with SQLite FTS5. If no key/model response is available, seeded normalized rows remain usable and a live import stays `needs_review` rather than fabricating a summary.

Use the official Structured Outputs API for the extractor schema, then validate it again locally because schema validity is not provenance validity. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

### Source-format minimum

| Kind | Input | Stored evidence | Demo rule |
|---|---|---|---|
| RSS/news | Feed metadata plus linked article text when configured | URL, headline, date, quoted spans | A cited-news source is labelled as such; it never masquerades as a government record. |
| Government document | HTML/PDF public record | Canonical URL, page when extractable, text spans | Do not surface claim-level results without a usable URL and locator. |
| Video transcript | Public transcript/captions for configured meeting/vote/town hall | Video URL, timestamp, transcript span | If timestamps are unavailable, show the source but exclude it from claim-level Chat citations. |

## Minimum SQLite schema

The data model deliberately has no users. An anonymous browser receives a random `visitor_id` cookie; clearing it simply starts a new local profile.

| Table | Essential columns / constraints | Purpose |
|---|---|---|
| `locations` | `id PK`, `label`, `parent_id FK NULL` | Queryable configured location tree. |
| `sources` | `id PK`, `location_id FK`, `kind`, `publisher`, `base_url`, `trust`, `enabled` | Registry mirror/provenance metadata. |
| `documents` | `id PK`, `source_id FK`, `canonical_url UNIQUE`, `title`, `published_at`, `content_hash UNIQUE`, `raw_text`, `status` | Raw immutable-ish imported public item. |
| `evidence` | `id PK`, `document_id FK`, `ordinal`, `quote`, `page_number NULL`, `start_seconds NULL`, `end_seconds NULL`, `UNIQUE(document_id, ordinal)` | Citable spans and locators. |
| `updates` | `id PK`, `document_id FK`, `location_id FK`, `kind`, `title`, `summary`, `topics_json`, `importance`, `published_at` | Feed card. |
| `claims` | `id PK`, `update_id FK`, `text`, `stance NULL`, `subject` | Model-normalized, source-bound factual/political claim. |
| `claim_evidence` | `claim_id FK`, `evidence_id FK`, `PRIMARY KEY(claim_id,evidence_id)` | Required provenance join. |
| `activity` | `id PK`, `visitor_id`, `location_id FK`, `event` (`seen | query`), `update_id NULL`, `query_text NULL`, `created_at` | Anonymous local personalization input. |
| `chat_turns` | `id PK`, `visitor_id`, `location_id FK`, `question`, `answer`, `created_at` | Optional local continuity/audit; never a retrieval source. |
| `update_fts` | FTS5 external/contentless index of title, summary, source text | Lexical evidence retrieval. |

Use parameterized statements exclusively. FTS5 is built into SQLite for full-text search, so it is the sufficient retrieval primitive for the small preprocessed corpus. [SQLite FTS5](https://sqlite.org/fts5.html)

## Feed and personalization

**Recent:** one SQL query filters `updates` by expanded location IDs, joins source/document/evidence, sorts by `published_at DESC`, and only returns updates with at least one evidence row.

**Curated:** derive a compact profile from the most recent 30 `activity` rows: topic counts from seen updates plus tokenized query terms. Candidate selection remains deterministic—same location/evidence constraint as Recent, newest 100, exclude recently seen. Ask GPT-5.6 once to return `{updateId, relevance: 0..1, reason}` only for supplied candidates; reject unknown IDs/range failures. Final score is `0.7 * model relevance + 0.2 * normalized topic overlap + 0.1 * recency`; tie-break by date. Without a key, use topic overlap + recency. This is personalized enough for the demo without embeddings, user accounts, or opaque storage.

Record `seen` when a card/evidence detail is opened and `query` after a Chat submit. Do not store full browser history, precise location, or anything outside app activity.

## Grounded Chat contract

1. Validate the selected location and rate-limit the anonymous visitor in process (or state that public demo is single-user). Retrieve only that location's expanded source set using FTS5 over update/document text; take 8–12 evidence spans and their immutable IDs.
2. Build a model input containing the question and a numbered evidence packet (`evidence_id`, exact quote, title, canonical URL, page/timestamp). No tools, browsing, URLs from the question, or prior model answer are available.
3. GPT-5.6 returns JSON `{answer, citations:[{evidenceId, supportingText}]}` with an instruction to answer "I don't have enough evidence in Lamplighter's sources" when unsupported.
4. The server parses structured output, requires at least one citation for any non-refusal factual answer, checks every `evidenceId` is in the retrieval packet, and requires nonempty locator. It renders citations from database URL/title/page/timestamp—not model-provided text. Invalid output becomes the same insufficient-evidence response.
5. Persist the question/answer only after validation. The UI renders an evidence link that opens the source at the stored timestamp/page; it does not render raw model HTML.

This makes retrieval and citation ownership deterministic, while the model only synthesizes from a closed packet. The Responses API supports text generation; structured output is the appropriate output contract for the extractor, ranker, and citation list. [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Security and trust boundaries

| Boundary | Enforcement |
|---|---|
| Browser -> application | Treat `locationId`, `visitor_id`, questions, and action payloads as untrusted; validate against registry/SQLite IDs and length limits. No API key or raw provider response reaches a Client Component. |
| Application -> public web | Registry allowlist, HTTPS, redirect revalidation, size/time limits, no user-supplied fetch URL (SSRF prevention). |
| Application -> SQLite | `server-only` DB module, parameterized SQL, foreign keys on, migrations committed; seed database read-only in demo mode. |
| Application -> OpenAI | Server-only environment variable; send only selected public evidence and bounded activity-derived topics; no arbitrary transcript browsing. |
| Model -> product truth | JSON schema plus local ID/range/locator checks; no uncited answer, citation, URL, claim, or feed card is accepted. |
| Display -> browser | Render answer and evidence as text/escaped React nodes; construct outbound links from stored canonical URLs; use `rel="noreferrer"` for external links. |

## Seeded demo and live path

Commit `data/lamplighter.seed.db` with the registry mirror, 12–20 curated public items, normalized updates/claims, FTS index, and at least: Indianapolis local action, Indiana policy/legislation, federal action, one document page citation, and one video timestamp citation. Ship `npm run demo` to copy it to a writable `data/lamplighter.db` if absent, then start Next. This is the one-command no-key judge path.

`npm run ingest` and `npm run normalize` are explicit developer commands. They require `OPENAI_API_KEY` only for model normalization/ranking; source import can still store raw records without it. A `DEMO_MODE=1` default blocks live import and selects deterministic Curated scoring, guaranteeing the screen recording remains reproducible.

## Dependency-aware build order

1. Scaffold strict TypeScript App Router/Tailwind, Node runtime, `server-only` database access, migration runner, and seed-copy `demo` command.
2. Implement registry, schema, seed records, repository queries, and Recent/evidence detail. Verify all cards already resolve to stored citations.
3. Implement RSS/document/transcript adapters plus manual CLI; test each against one configured source and persist raw records before adding AI.
4. Add structured normalization and local provenance validation; keep seeded normalized rows as the fallback.
5. Add activity tracking and deterministic Curated scoring; then layer optional model ranking with ID validation.
6. Add closed-packet Chat, citation validation, refusal state, and timestamp/page evidence links.
7. Finish responsive bottom navigation, fixture/demo smoke checks, README/runbook, and screen-recording data reset instructions.

This order leaves a demonstrable cited feed working before live ingestion or AI calls. The high-risk trust boundary (evidence ownership) is implemented once in the repository/chat orchestration before UI polish.

## Explicit non-goals for this build

- No embeddings/vector store: FTS5 plus a small, curated corpus is easier to audit and seed. Add hybrid/vector retrieval only when corpus size or synonym recall demonstrably fails.
- No background worker/cron: manual CLI import is enough for deadline reliability. Add a queue only when refresh work must outlive a request or run unattended.
- No generic source plugin system: three small adapters and typed registry entries cover the stated formats. Generalize only after a fourth materially different source format.
- No accounts or cross-device personalization: anonymous local activity proves the experience without identity/security scope.

## Research confidence and open checks

| Area | Confidence | Why / check before implementation |
|---|---:|---|
| Server-only App Router architecture | High | Directly supported by Next.js server/client documentation. |
| SQLite + FTS5 for seeded corpus | High | Built-in FTS5 and local SQLite match the no-scale demo constraint. Benchmark seeded query latency after schema creation. |
| `better-sqlite3` Node deployment | High | Fits a local Node process; ensure deployment is not configured for Edge/serverless ephemeral storage. |
| Structured extraction/answer protocol | High | API supports structured outputs; local provenance checks remain required by product policy. |
| Individual government/transcript sources | Medium | Registry sources must be manually verified for stable public URLs, terms, transcript/page locators, and permitted fetch patterns before they are enabled. |
| GPT-5.6 model identifier/availability | Medium | Project requires it, but pin the exact current model ID and SDK call shape from official OpenAI docs during implementation; seed path must not depend on it. |

## Sources

- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — server data/secrets boundary and client module graph behavior.
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — prepared statements and transactions.
- [SQLite FTS5 Extension](https://sqlite.org/fts5.html) — built-in full-text retrieval.
- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema-constrained model responses.
- [OpenAI: Text generation](https://developers.openai.com/api/docs/guides/text) — Responses API text-generation boundary.
