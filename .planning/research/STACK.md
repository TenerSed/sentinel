# Lamplighter stack research

**Researched:** 2026-07-18  
**Confidence:** High for the framework, runtime, database, and OpenAI API choices; medium for individual source adapters because each publisher exposes different formats and reliability.

## Recommendation

Build one Node.js Next.js App Router application with a file-backed, seeded SQLite database. Use server-rendered pages for reads, small Route Handlers for browser mutations and live ingestion, and one server-only model module using the official OpenAI Node SDK and Responses API. Keep the source registry, retrieval, citation validation, and demo data deterministic; GPT-5.6 only produces structured extraction, ranking signals, and answers from application-selected evidence.

| Concern | Choose | Why |
| --- | --- | --- |
| Web app | Next.js **16.2.10**, React **19.2.7**, TypeScript **7.0.2**, App Router | Matches the stated stack; App Router has server components and Route Handlers in the same app. Next requires Node.js 20.9+ ([installation](https://nextjs.org/docs/app/getting-started/installation), [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)). |
| Styling | Tailwind CSS **4.3.3** with `@tailwindcss/postcss` **4.3.3** | Required, current official Next setup, and sufficient for the three responsive screens without a component library ([guide](https://tailwindcss.com/docs/guides/nextjs)). |
| Server boundary | `app/api/**/route.ts`, `runtime = 'nodejs'`, and modules marked `import 'server-only'` | Browser code never imports the database or OpenAI client. Route Handlers use standard Request/Response APIs ([Next BFF guide](https://nextjs.org/docs/app/guides/backend-for-frontend)); Node runtime is mandatory for the native SQLite binding. |
| Database | SQLite + `better-sqlite3` **12.11.1** and `@types/better-sqlite3` **7.6.13** | Required; its synchronous, prepared-statement API is a good fit for a single-process demo and transactions ([project](https://github.com/WiseLibs/better-sqlite3), [API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)). |
| Search | SQLite FTS5, no vector store | Full-text matching over the small, curated corpus is transparent and deterministic. FTS5 is part of SQLite ([official documentation](https://www.sqlite.org/fts5.html)). Add embeddings only after a measured retrieval failure. |
| XML/RSS | native `fetch` plus `fast-xml-parser` **5.10.1** | `fetch` avoids an HTTP client; this one parser handles RSS/Atom/XML reliably. Do not add a generic feed reader when the source registry owns each source's mapping. |
| Model API | `openai` **6.48.0**, Responses API, model ID from `OPENAI_MODEL` (default `gpt-5.6`) | Official TypeScript SDK ([openai-node](https://github.com/openai/openai-node)); Responses is the current unified API and Structured Outputs can enforce JSON Schema ([Responses reference](https://developers.openai.com/api/docs/api-reference/responses), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)). |
| Runtime validation | Zod **4.4.3** | Validate request bodies, source-adapter results, stored JSON, and model output at trust boundaries. It is a small addition that prevents malformed model/provider data from becoming a claim. |

Version numbers above were checked from npm on the research date. Use exact versions for the demo's reproducible lockfile; review release notes deliberately when upgrading native database dependencies.

## Implementation shape

### Boundaries and routes

- `app/page.tsx` renders the selected location's Recent feed from SQLite. Client components are limited to location selection, bottom navigation, read events, and chat input.
- `app/api/chat/route.ts` accepts a question and selected location. It retrieves only local, citation-bearing chunks; it sends those chunks plus immutable citation IDs to GPT-5.6; it rejects any returned citation ID not in that allow-list.
- `app/api/read-events/route.ts` records anonymous local/demo reading events. The Curated view uses a deterministic recency/topic score first; GPT-5.6 may emit a bounded relevance label/summary for already retrieved items, never invent candidates.
- `app/api/ingest/route.ts` is a local/server operation for the demo. It reads the registry, fetches each public source, normalizes it, deduplicates by canonical URL/content hash, and writes in a transaction. It is not a cron or public production endpoint.
- Put `import 'server-only'` at the top of `lib/db.ts`, `lib/openai.ts`, `lib/retrieve.ts`, and `lib/ingest.ts`. Set `export const runtime = 'nodejs'` in every route that imports them.

### Data model: raw evidence first

Use direct SQL migrations (a numbered `migrations/` directory and one migration runner) rather than an ORM. The demo needs a small, inspectable schema, and SQLite's constraints are enough.

| Table | Minimum purpose |
| --- | --- |
| `locations` | Stable IDs for Indianapolis, Indiana, and U.S. federal coverage. |
| `sources` | Registry records: location, publisher, URL/feed URL, source kind, active flag, and parser name. |
| `documents` | Canonical source record: URL, title, published/collected time, raw text, optional raw metadata JSON, hash, and source ID. Enforce `UNIQUE(canonical_url)` and retain original URLs. |
| `evidence` | Citable excerpt linked to a document: text, ordinal, optional `page_number`, `start_seconds`, and `end_seconds`. This is the only unit supplied to Chat. |
| `claims` | Optional structured extraction tied to one or more `evidence` rows; store model output as reviewable data, not truth. |
| `read_events` | Anonymous local session ID, document ID, and timestamp. |
| `document_fts` | FTS5 index over title/body for retrieval; rebuild from `documents` during seed/ingest. |

Do not use an opaque `citations` JSON blob as the source of truth. A displayed citation resolves through `evidence -> documents -> sources`, carries a direct original URL, and presents `#t=SECONDS` for hosted video where supported or a page locator for PDFs. Preserve the raw downloaded artifact/URL and retrieval timestamp so the displayed claim can be audited.

### Grounded model calls

1. Deterministically filter by chosen location and active source; retrieve a small FTS5 result set and split only those documents into bounded evidence excerpts.
2. Ask GPT-5.6 for a strict structured object such as `{ answer, citation_ids, uncertainty }`. The schema must require at least one citation for a non-empty factual answer.
3. Validate with Zod and enforce again in application code: all IDs must be from the supplied evidence allow-list, every visible factual assertion has a citation, and no evidence means a brief "I don't have enough cited public material" response.
4. Store the answer only as an ephemeral chat response for this demo; do not let model text change source facts, locations, citations, or rankings without deterministic validation.

Use the SDK's Responses API structured-output facility, not hand-parsed JSON. The API documentation states that Structured Outputs enforce the JSON Schema supplied by the application ([official guide](https://developers.openai.com/api/docs/guides/structured-outputs)). Set the API key only through `OPENAI_API_KEY`; never prefix it with `NEXT_PUBLIC_` or call the SDK from a Client Component.

### Ingestion and seed path

The source registry is a typed local configuration file, not a database-admin UI. Define a tiny adapter contract internally (`fetch -> normalize -> evidence`) and implement only the initial configured sources:

- RSS/Atom/news feeds: `fetch` XML, parse, then fetch the canonical linked page only when its item is new.
- Government HTML/PDF: save canonical URL and extracted text; pages must become `page_number` evidence where page text is available.
- Public meeting/video transcripts: ingest publisher-provided transcript/caption text only when publicly accessible; preserve cue start/end seconds. Do not attempt automatic transcription for the deadline demo.

Ship `data/lamplighter.db` preloaded by a deterministic `npm run seed` script. The normal app starts and demonstrates Recent, Curated, citations, and grounded Chat without `OPENAI_API_KEY`; in no-key mode, return seeded answer fixtures that go through the same citation-ID validation and UI as the live model path. `npm run ingest` remains available when an API key/network is present, but no background job, webhook, or scheduler is needed.

## Installation

Use npm and a supported Node version (Node 20.9+; current Node LTS is preferred):

```sh
npx create-next-app@latest . --typescript --eslint --app
npm install openai@6.48.0 better-sqlite3@12.11.1 fast-xml-parser@5.10.1 zod@4.4.3
npm install -D @types/better-sqlite3@7.6.13 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 postcss
```

Then configure Tailwind using the official Next guide, add `.env.local` with `OPENAI_API_KEY` only for live calls, commit the generated lockfile and seeded database, and set Node runtime on SQLite/OpenAI routes. The `better-sqlite3` maintainers note that it is a Node-process library and require supported Node versions ([troubleshooting](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md)); it must not be imported into Edge middleware, client code, or a static export.

## Rejected alternatives

| Alternative | Decision |
| --- | --- |
| Prisma/Drizzle/another ORM | Skip. SQL migrations plus prepared statements are fewer dependencies and make citation joins and FTS5 explicit. Revisit only if schema churn becomes the bottleneck. |
| Postgres, hosted vector DB, Redis | Skip. They add deployment state with no demo value. SQLite FTS5 handles the curated corpus. |
| LangChain, an agent framework, OpenAI hosted file search/web search | Skip. They obscure the required local source/citation boundary and add moving parts. The app selects evidence; the model answers it. |
| Browser-side OpenAI calls or direct source fetching | Reject. This would expose secrets or bypass the source registry/citation enforcement. |
| Background queue, cron, webhook, auth, accounts | Skip for the deadline scope; a manual ingestion script and anonymous local read history meet the product requirements. |
| Generic news API/vendor aggregation | Skip as a dependency. Direct publisher feeds and official records keep provenance visible; add one only if a named source has no public feed/document endpoint. |
| Automatic transcription or OCR pipeline | Skip for v1. Seed public transcripts and page-addressable documents. Add only after a target source proves unavailable in text form. |

## Source links

- [Next.js installation and Node requirement](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js Backend for Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Tailwind CSS Next.js guide](https://tailwindcss.com/docs/guides/nextjs)
- [OpenAI Responses API reference](https://developers.openai.com/api/docs/api-reference/responses)
- [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Official OpenAI Node SDK](https://github.com/openai/openai-node)
- [better-sqlite3 project and API](https://github.com/WiseLibs/better-sqlite3)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
