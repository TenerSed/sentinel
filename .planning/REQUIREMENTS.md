# Requirements: Lamplighter

**Defined:** 2026-07-18  
**Core Value:** Government watches us; Lamplighter helps people watch government back with a trustworthy, personalized, source-grounded view of what changed and why it matters.

## v1 Requirements

### Foundation & Evidence

- [ ] **FOUND-01**: A judge can start the app with a committed, preprocessed SQLite dataset and no API key or network dependency for the core demo.
- [ ] **FOUND-02**: The application stores configured locations, sources, documents, evidence spans, civic updates, claims, activity, and chat turns in SQLite with foreign-key integrity.
- [ ] **FOUND-03**: Every displayed civic update and factual answer claim links to stored evidence containing an exact quote, source URL, and page or video-timestamp locator when applicable.
- [ ] **FOUND-04**: Application queries enforce selected-location and configured-source boundaries before content reaches the UI or a model.
- [ ] **FOUND-05**: All database, provider, and model operations run server-side; client components never receive secrets.

### Location & Sources

- [ ] **LOC-01**: A user can select Indianapolis, Indiana, or U.S. federal coverage from the configured location registry.
- [ ] **LOC-02**: A selected local location includes its configured state and federal coverage according to registry relationships.
- [ ] **LOC-03**: The initial bundled dataset contains verifiable public government publications, public video-transcript evidence, and cited news for the supported coverage levels.
- [ ] **LOC-04**: A maintainer can run a manual, allowlisted ingestion command that normalizes URLs, deduplicates content, and records source retrieval metadata without enabling cron jobs or scraping at scale.

### Recent Feed

- [ ] **RECN-01**: A user can view recent legislation, office-holder, and policy updates for the selected coverage.
- [ ] **RECN-02**: Each feed item identifies its source, publication/update date, jurisdiction, and a direct citation.
- [ ] **RECN-03**: A user can open an evidence panel that shows the supporting quote and links to the exact document page or video timestamp when available.
- [ ] **RECN-04**: The feed clearly distinguishes a primary public record from a news report and does not present feed date as legal or policy status.

### Grounded Chat

- [ ] **ASK-01**: A user can ask about legislation, policy updates, office holders, or a candidate’s recently public position from the selected location’s surfaced evidence.
- [ ] **ASK-02**: The server retrieves only selected-location, configured-source evidence and supplies a closed evidence packet to GPT-5.6.
- [ ] **ASK-03**: GPT-5.6 output uses an application-defined structured schema; application code validates every returned evidence ID before rendering it as a citation.
- [ ] **ASK-04**: A supported answer renders citation chips that open the same evidence panel used by the feed.
- [ ] **ASK-05**: If the evidence cannot support an answer, the app explicitly says so rather than inferring or inventing a claim.

### Curated Feed

- [ ] **CUR-01**: A user can view a curated feed that ranks only eligible, evidence-backed updates from the selected location coverage.
- [ ] **CUR-02**: Curated ranking uses recent anonymous reading and query activity, topic overlap, and recency, with a deterministic fallback for the seeded demo.
- [ ] **CUR-03**: Each curated item explains why it was surfaced without inferring a user’s ideology or storing more activity data than necessary.
- [ ] **CUR-04**: A user can reset their local personalization history.

### Product & Submission

- [ ] **PROD-01**: A user can navigate Recent, Curated, and Chat through an accessible bottom navigation interface.
- [ ] **PROD-02**: The product provides clear loading, empty, failure, and insufficient-evidence states.
- [ ] **PROD-03**: The repository includes a complete README with the no-key demo path, optional live rebuild path, bundled-data provenance, limitations, and specific Codex/GPT-5.6 contributions.
- [ ] **PROD-04**: The repository includes an MIT license, source-aware demo data, and automated checks for evidence/citation validation, location scoping, and personalization reset behavior.

### Local Settings

- [ ] **SET-01**: A user can open an Account tab that manages local-only Lamplighter preferences without an account, authentication, or server-side profile.
- [ ] **SET-02**: A user can change the active coverage, manage Curated topics, and reset local personalization from Account while preserving Chat history unless they explicitly clear it.
- [ ] **SET-03**: Account makes local data handling and optional provider availability clear without exposing, collecting, or configuring secrets in the browser.

## v2 Requirements

### Scale & Coverage

- **SCALE-01**: A maintainer can add arbitrary jurisdictions through a self-service source onboarding flow.
- **SCALE-02**: The system continuously ingests sources with scheduled jobs, retries, and monitoring.
- **SCALE-03**: The system uses a multi-tenant database/search architecture for broad civic coverage.
- **SCALE-04**: Users can create accounts, sync preferences, and receive email or push alerts.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Parcel-specific political-history graph | Explicitly removed in favor of the civic feed, Curated, and Chat experience. |
| Open-web or uncited political answers | The product must ground claims in its stored public evidence. |
| Live ingestion at scale, cron jobs, webhooks | A small manual source registry is reliable within the Build Week deadline. |
| Nationwide source onboarding | Indianapolis, Indiana, and federal coverage prove the location model without broad data risk. |
| Accounts, multi-tenancy, digests, and alerts | Do not serve the short demo’s core loop. |
| Campaign persuasion or political profiling | The product reports public civic information; it does not infer ideology or target persuasion. |
| Marketing site or business model | The deliverable is a working product demo. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Pending |
| LOC-01 | Phase 2 | Pending |
| LOC-02 | Phase 2 | Pending |
| LOC-03 | Phase 1 | Pending |
| LOC-04 | Phase 2 | Pending |
| RECN-01 | Phase 2 | Pending |
| RECN-02 | Phase 2 | Pending |
| RECN-03 | Phase 2 | Pending |
| RECN-04 | Phase 2 | Pending |
| ASK-01 | Phase 3 | Pending |
| ASK-02 | Phase 3 | Pending |
| ASK-03 | Phase 3 | Pending |
| ASK-04 | Phase 3 | Pending |
| ASK-05 | Phase 3 | Pending |
| CUR-01 | Phase 4 | Pending |
| CUR-02 | Phase 4 | Pending |
| CUR-03 | Phase 4 | Pending |
| CUR-04 | Phase 4 | Pending |
| PROD-01 | Phase 2 | Pending |
| PROD-02 | Phase 5 | Pending |
| PROD-03 | Phase 5 | Pending |
| PROD-04 | Phase 5 | Pending |
| SET-01 | Phase 04.1 | Pending |
| SET-02 | Phase 04.1 | Pending |
| SET-03 | Phase 04.1 | Pending |

**Coverage:**

- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-07-18*  
*Last updated: 2026-07-18 after initialization*
