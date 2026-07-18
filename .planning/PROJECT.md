# Lamplighter

## What This Is

Lamplighter is a civic-intelligence feed for people who want to follow their local, state, and federal government without manually monitoring scattered public records. A user selects a location, sees fresh government and policy updates, receives a personalized curated view based on their recent reading and questions, and can ask grounded questions about legislation, policy, office holders, and public candidate positions.

The demo ships with a reliable source registry for Indianapolis, Indiana, and U.S. federal coverage. It includes cited news, government publications, and public video transcripts such as meetings, town halls, and legislative votes.

## Core Value

Government watches us; Lamplighter helps people watch government back with a trustworthy, personalized, source-grounded view of what changed and why it matters.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] A user can select a location and view its configured public-government source coverage.
- [ ] A user can see recent legislation, office-holder, and policy updates with direct source citations.
- [ ] A user can receive a curated government feed that adapts to their recent reading and questions.
- [ ] A user can ask questions only against surfaced, cited public sources and receive a grounded answer.
- [ ] A user can open video- and document-based evidence at the cited timestamp or page.

### Out of Scope

- Parcel-specific political-history graphs — removed from the product focus in favor of a broader civic-intelligence feed.
- Nationwide scraping, live ingestion at scale, cron jobs, and webhooks — a reliable small source registry is the deadline-safe first release.
- User accounts, auth, multi-tenancy, email digests, and alerts — not needed to prove the core demo.
- A polished marketing site or business model — the submission needs a coherent product demo.
- Uncited political claims or open-web answers — public-source provenance is required for trust.

## Context

- **Track:** Work & Productivity.
- **Demo:** a screen-recorded, voice-over walkthrough for OpenAI Build Week judges; it must visibly show a working product and explain Codex and GPT-5.6 usage.
- **Initial coverage:** Indianapolis, Indiana, and U.S. federal sources. Location selection is product functionality; adding jurisdictions should be configuration-driven through a source registry.
- **Primary source types:** public government publications, legislation and policy records, public meeting/town-hall/vote video transcripts, and cited news.
- **Primary screens:** bottom navigation to Recent, Curated, and Chat.
- **Model boundary:** GPT-5.6 performs structured extraction, semantic relevance/personalization, and grounded answers. Deterministic application logic enforces location, source, citation, and retrieval boundaries.
- **Demo reliability:** bundle a preprocessed SQLite database and safe sample data so judges can run the product without API keys; the live ingestion pipeline must still work.

## Constraints

- **Deadline:** OpenAI Build Week submission is due Tuesday, July 21, 2026 at 5:00 PM PT — scope must favor one reliable demo path.
- **Stack:** Next.js App Router, strict TypeScript, Tailwind CSS, SQLite via `better-sqlite3`, RSS/news-provider ingestion, and GPT-5.6 through the official OpenAI Node SDK.
- **Security:** Provider and model calls run server-side; secrets never reach client components.
- **Evidence:** Every factual Chat answer and surfaced political claim must resolve to a stored public source citation; video citations retain timestamps and document citations retain page locators where available.
- **Quality:** Prefer missing uncertain information over inventing a claim, conflict, or candidate position.
- **Submission:** New code built during the submission period, frequent dated commits, MIT license, one-command judge path, and README documentation of Codex and GPT-5.6 use.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Civic intelligence feed over parcel graph | Better expresses the enduring product value: residents can monitor government across local, state, and federal levels. | — Pending |
| Indianapolis/Indiana/federal as initial registry | Produces a focused, reliable demo while keeping location selection and source configuration real. | — Pending |
| Recent, Curated, and Chat as the three primary views | Makes the value legible in a short screen-recorded demo. | — Pending |
| Public sources only, with stored citations | Political and policy answers must be auditable and cannot rely on unsupported model assertions. | — Pending |
| Seeded SQLite demo plus live ingestion | Judges get a no-key path while the product remains a working ingestion system. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason.
2. Requirements validated? → Move to Validated with phase reference.
3. New requirements emerged? → Add to Active.
4. Decisions to log? → Add to Key Decisions.
5. “What This Is” still accurate? → Update if drifted.

**After each milestone** (via `$gsd-complete-milestone`):

1. Full review of all sections.
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state.

---
*Last updated: 2026-07-18 after initialization*
