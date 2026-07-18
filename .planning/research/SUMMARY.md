# Lamplighter research synthesis

**Researched:** 2026-07-18  
**Decision:** Ship a narrow, offline-runnable civic-intelligence demo for Indianapolis, Indiana, and U.S. federal coverage. SQLite is the evidence and retrieval system; GPT-5.6 may extract, rank, and draft answers only from application-selected evidence. Deterministic code owns jurisdiction, source, retrieval, citation, and refusal decisions.

## Executive summary

Lamplighter's deadline-safe proof is one trustworthy loop: select a configured jurisdiction, read a recent cited update, open the exact public record, then ask a question that either returns evidence-bound citations or plainly abstains. The judge path must work with no network, API key, account, or live ingestion: commit a hand-verified SQLite seed containing 12–20 records across the three coverage levels, including a document-page and a video-timestamp citation.

Do not broaden coverage or infrastructure before this loop works. The reliable product is a civic-information feed, not a campaigning, persuasion, political-profiling, open-web-chat, or nationwide-scraping product.

## Key findings

| Area | Prescriptive finding |
| --- | --- |
| Product | Recent, Curated, and Chat are sufficient primary views. A configured location selector must state coverage honestly; Indianapolis can inherit Indiana and federal sources through registry relationships. |
| Evidence | Store raw documents plus ordered evidence spans. Every displayed factual claim must resolve through `claim -> evidence -> document -> source`, with canonical URL, publisher, jurisdiction, dates, retrieval time, hash/version, and page or timestamp where applicable. |
| Retrieval | Use SQLite FTS5 over the small preprocessed corpus. Retrieve only evidence from the selected location's configured sources; do not add embeddings, a vector database, agent framework, or hosted search. |
| Model use | Use the official Node SDK/Responses API with Structured Outputs, then validate locally. GPT-5.6 receives a closed evidence packet and may return only allowlisted evidence IDs. Invalid, uncited, or unsupported output becomes a refusal. |
| Personalization | Rank only cited, location-eligible candidates using recent anonymous `seen`/`query` activity, topic overlap, and recency. Explain the reason, provide reset capability, avoid ideology inference, and keep personalized responses out of shared caches. |
| Ingestion | Use a typed, allowlisted source registry and a manual CLI. RSS is discovery, not proof: fetch the canonical record when permitted, normalize URLs, hash content, deduplicate, and quarantine parse failures. |
| Reliability | Bundle a seed database and deterministic no-key answer/ranking fixtures. Live ingestion and model calls are optional server-only paths, never prerequisites to the recorded or judged flow. |
| Deployment | Run SQLite routes in the Node runtime, not Edge or multi-instance ephemeral serverless. `better-sqlite3` suits a single Node-process demo; it is not distributed storage. |

## Phase-structure implications

### Phase 1 — foundation and evidence contract

Create the strict TypeScript Next.js App Router app, Tailwind, Node-only server boundary, SQLite migration runner, typed registry, and seed-copy demo command. Implement the minimal evidence-first schema: locations, sources, documents, evidence, updates, claims, claim-evidence joins, activity, chat turns, and FTS5. Enforce parameterized SQL, foreign keys, `server-only` database/model modules, canonical URL/hash uniqueness, and locator requirements.

**Exit gate:** `npm run demo` starts with no key/network and a seed has local, state, and federal records, including page and timestamp evidence.

### Phase 2 — cited Recent experience and source ingestion

Implement expanded-location feed queries, source/provenance display, Recent cards, and evidence opening. A feed item requires evidence; document links show pages and video links open at stored time. Add only the small manual RSS/document/transcript adapters needed for configured sources, preserving raw artifacts, extraction metadata, freshness dates, and failures.

**Exit gate:** every visible seed card and citation resolves to the intended public record; a manual check confirms document pages and video timestamps.

### Phase 3 — grounded Chat and normalization

Add closed-packet FTS retrieval (8–12 evidence spans), server-side structured extraction/answer calls, model-output validation, claim-level citation rendering, and the shared insufficient-evidence refusal. Treat source text as untrusted; never let a prompt, URL, citation, or claim from the model cross the boundary unvalidated.

**Exit gate:** a supported question produces only retrieved citations; unsupported and adversarial questions refuse; no model key still follows a validated seeded-answer path.

### Phase 4 — minimal Curated view

Record limited anonymous interaction activity, calculate deterministic topic/recency ranking over the same eligible evidence-backed candidates, show a lightweight “why this” explanation, and support reset. Optional model relevance scoring is bounded to supplied IDs and has deterministic fallback.

**Exit gate:** Curated changes from seeded/local interactions without exposing raw history, inferring politics, or leaking across visitors.

### Phase 5 — demo hardening and submission

Add responsive bottom navigation, accessibility basics, smoke checks for Recent → evidence → Chat, data reset instructions, README/runbook, MIT license, and Build Week evidence. Re-verify every seed URL, page, timestamp, and scripted answer immediately before recording.

**Exit gate:** one-command, no-key core demo; public voiced video under three minutes; repository/docs show GPT-5.6 and Codex use and data provenance.

## Ordering rationale

Evidence ownership is the highest-risk and most reused boundary, so it must precede feeds, Chat, and polish. A seeded Recent flow proves the core value without external failure modes. Live ingestion comes after the database can safely retain and audit source material. Chat comes only after retrieval and citation validation exist. Curated is later because it adds value by reordering the already-safe corpus, not by expanding truth claims. Demo hardening stays last, but the offline seed path is established in Phase 1 so deadline risk never accumulates behind live dependencies.

## Research flags

- **Trust gate:** no factual card or answer sentence without stored evidence and a resolvable locator. Distinguish introduced, passed, and signed; label news as reporting rather than primary legal/status proof.
- **Freshness:** keep publication, update, retrieval, and effective/action dates; refresh rosters and status data before recording; do not equate feed date with current status.
- **Extraction QA:** preserve PDF bytes/hash, extractor/version, page spans, and inspect seeded PDF pages. Use only public, verified transcript text; confirm each demo timestamp by playback and leave speakers unknown when not attributable.
- **Security/privacy:** validate all browser input; registry-allowlist network fetches with redirect, timeout, size, and content-type checks; expose no secrets; minimize/expire anonymous preference data.
- **Operations:** default `DEMO_MODE=1` to deterministic behavior and block live import; no cron, webhook, queue, auth, accounts, CMS, or generic connector system in this release.
- **Compliance:** verify source/video terms and Build Week submission rules. Maintain dated commits and document provenance, setup, sample data, Codex, and GPT-5.6 use.

## Confidence assessment

**High confidence:** App Router server boundaries, Node + `better-sqlite3`, SQLite FTS5, a typed registry, evidence-first data model, structured-output-plus-local-validation, anonymous minimal personalization, and the seeded offline judge path. These directly satisfy the stated scope and are supported by official framework/database/API documentation.

**Medium confidence:** individual publisher adapters, stable transcript/page locators, permitted third-party transcript use, live feed behavior, and exact GPT-5.6 availability/call shape. These vary by source or release and must not affect the seed path.

## Sources

- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), and [deployment guidance](https://nextjs.org/docs/app/guides/deploying-to-platforms)
- [SQLite FTS5](https://sqlite.org/fts5.html) and [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses API](https://developers.openai.com/api/docs/api-reference/responses), and [OpenAI Node SDK](https://github.com/openai/openai-node)
- [Congress.gov API](https://api.congress.gov/), [Indianapolis council/committee calendar](https://calendar.indy.gov/location/06f77ee5-a704-4b7e-82e6-d550ed7e354c/), [Indiana General Assembly bills](https://iga.in.gov/legislative/2016/bills), and [U.S. House roll-call XML](https://xml.house.gov/)
- [NARA digitization strategy](https://www.archives.gov/digitization/strategy.html), [NIST Privacy Framework](https://www.nist.gov/privacy-framework/getting-started-0), [OpenAI political campaigning restrictions](https://help.openai.com/en/articles/20001255-political-campaigning-restrictions), and [OpenAI Build Week rules](https://openai.devpost.com/rules)

## Unresolved gaps

1. Select and manually verify the exact initial source registry entries, their stable URLs, fetch permissions, freshness windows, and the seed's 12–20 records.
2. Validate every seeded PDF page and video timestamp against the original public artifact; determine whether any needed transcript has acceptable provenance/licensing.
3. Confirm the exact available GPT-5.6 model ID, SDK Structured Outputs call shape, and any model pinning before enabling live calls.
4. Decide the actual single-process deployment/judge command and prove the database's writable/read-only behavior matches it.
5. Write and run the citation and no-key smoke checks; prepare the final three-minute voiced demonstration and submission checklist.
