<!-- GSD:project-start source:PROJECT.md -->

## Project

**Lamplighter**

Lamplighter is a civic-intelligence feed for people who want to follow their local, state, and federal government without manually monitoring scattered public records. A user selects a location, sees fresh government and policy updates, receives a personalized curated view based on their recent reading and questions, and can ask grounded questions about legislation, policy, office holders, and public candidate positions.

The demo ships with a reliable source registry for Indianapolis, Indiana, and U.S. federal coverage. It includes cited news, government publications, and public video transcripts such as meetings, town halls, and legislative votes.

**Core Value:** Government watches us; Lamplighter helps people watch government back with a trustworthy, personalized, source-grounded view of what changed and why it matters.

### Constraints

- **Deadline:** OpenAI Build Week submission is due Tuesday, July 21, 2026 at 5:00 PM PT — scope must favor one reliable demo path.
- **Stack:** Next.js App Router, strict TypeScript, Tailwind CSS, SQLite via `better-sqlite3`, RSS/news-provider ingestion, and GPT-5.6 through the official OpenAI Node SDK.
- **Security:** Provider and model calls run server-side; secrets never reach client components.
- **Evidence:** Every factual Chat answer and surfaced political claim must resolve to a stored public source citation; video citations retain timestamps and document citations retain page locators where available.
- **Quality:** Prefer missing uncertain information over inventing a claim, conflict, or candidate position.
- **Submission:** New code built during the submission period, frequent dated commits, MIT license, one-command judge path, and README documentation of Codex and GPT-5.6 use.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommendation

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

## Implementation shape

### Boundaries and routes

- `app/page.tsx` renders the selected location's Recent feed from SQLite. Client components are limited to location selection, bottom navigation, read events, and chat input.
- `app/api/chat/route.ts` accepts a question and selected location. It retrieves only local, citation-bearing chunks; it sends those chunks plus immutable citation IDs to GPT-5.6; it rejects any returned citation ID not in that allow-list.
- `app/api/read-events/route.ts` records anonymous local/demo reading events. The Curated view uses a deterministic recency/topic score first; GPT-5.6 may emit a bounded relevance label/summary for already retrieved items, never invent candidates.
- `app/api/ingest/route.ts` is a local/server operation for the demo. It reads the registry, fetches each public source, normalizes it, deduplicates by canonical URL/content hash, and writes in a transaction. It is not a cron or public production endpoint.
- Put `import 'server-only'` at the top of `lib/db.ts`, `lib/openai.ts`, `lib/retrieve.ts`, and `lib/ingest.ts`. Set `export const runtime = 'nodejs'` in every route that imports them.

### Data model: raw evidence first

| Table | Minimum purpose |
| --- | --- |
| `locations` | Stable IDs for Indianapolis, Indiana, and U.S. federal coverage. |
| `sources` | Registry records: location, publisher, URL/feed URL, source kind, active flag, and parser name. |
| `documents` | Canonical source record: URL, title, published/collected time, raw text, optional raw metadata JSON, hash, and source ID. Enforce `UNIQUE(canonical_url)` and retain original URLs. |
| `evidence` | Citable excerpt linked to a document: text, ordinal, optional `page_number`, `start_seconds`, and `end_seconds`. This is the only unit supplied to Chat. |
| `claims` | Optional structured extraction tied to one or more `evidence` rows; store model output as reviewable data, not truth. |
| `read_events` | Anonymous local session ID, document ID, and timestamp. |
| `document_fts` | FTS5 index over title/body for retrieval; rebuild from `documents` during seed/ingest. |

### Grounded model calls

### Ingestion and seed path

- RSS/Atom/news feeds: `fetch` XML, parse, then fetch the canonical linked page only when its item is new.
- Government HTML/PDF: save canonical URL and extracted text; pages must become `page_number` evidence where page text is available.
- Public meeting/video transcripts: ingest publisher-provided transcript/caption text only when publicly accessible; preserve cue start/end seconds. Do not attempt automatic transcription for the deadline demo.

## Installation

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

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
