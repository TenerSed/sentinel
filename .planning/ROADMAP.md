# Roadmap: Lamplighter

## Overview

Lamplighter ships as a reliable, offline-runnable civic-intelligence demo. The work builds outward from an evidence-owned SQLite foundation: establish trustworthy records first, make them usable through Recent, then add grounded Chat and Curated, and finish with submission reliability.

## Phases

### Phase 1: Evidence Foundation

**Goal:** Establish the offline, source-scoped evidence system that every product view depends on.

**Requirements:** FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, LOC-03

**Success criteria:**

1. `npm run demo` starts the core experience from committed SQLite data with no API key or network access.
2. SQLite stores locations, sources, documents, evidence, updates, claims, activity, and chat turns with foreign-key integrity.
3. Seeded public records cover Indianapolis, Indiana, and federal levels, including both page and timestamp evidence.
4. Every stored/displayable claim resolves to quoted evidence with a URL and applicable page or timestamp locator.
5. Database and provider/model modules are server-only and location/source checks occur before retrieval or rendering.

### Phase 2: Source Coverage and Recent

**Goal:** Let users select real configured coverage, read recent cited civic updates, and inspect their evidence.

**Requirements:** LOC-01, LOC-02, LOC-04, RECN-01, RECN-02, RECN-03, RECN-04, PROD-01

**Success criteria:**

1. Users can select Indianapolis, Indiana, or U.S. federal coverage; Indianapolis expands to its configured state and federal sources.
2. Recent shows scoped legislation, office-holder, and policy updates with jurisdiction, date, source type, and direct citation.
3. Evidence panels show the supporting quote and open the exact document page or video timestamp when available.
4. The feed labels primary records versus news reporting and does not treat feed date as legal or policy status.
5. A maintainer can run a manual allowlisted import that normalizes URLs, deduplicates records, and records retrieval metadata.

### Phase 3: Grounded Chat

**Goal:** Answer civic questions only from selected, surfaced evidence, with validated citations or a clear refusal.

**Requirements:** ASK-01, ASK-02, ASK-03, ASK-04, ASK-05

**Success criteria:**

1. Chat accepts supported civic questions for the selected location and retrieves only configured-source evidence for that coverage.
2. GPT-5.6 receives a closed evidence packet and its structured output is locally validated against stored evidence IDs.
3. Supported answers render citation chips that open the shared evidence panel.
4. Unsupported, uncited, or invalid model output returns an explicit insufficient-evidence response.

### Phase 4: Curated

**Goal:** Personalize the safe corpus without political profiling or weakening evidence and location rules.

**Requirements:** CUR-01, CUR-02, CUR-03, CUR-04

**Success criteria:**

1. Curated ranks only evidence-backed updates eligible for the selected location coverage.
2. Ranking responds to minimal anonymous reading/query activity, topic overlap, and recency, with a deterministic seeded fallback.
3. Each item gives a plain “why this” explanation without ideology inference or unnecessary activity retention.
4. Users can reset their local personalization history.

### Phase 5: Submission Hardening

**Goal:** Make the three-view product accessible, testable, documented, and dependable for judges.

**Requirements:** PROD-02, PROD-03, PROD-04

**Success criteria:**

1. Recent, Curated, and Chat provide clear loading, empty, failure, and insufficient-evidence states.
2. The repository includes an MIT license and README covering no-key demo, optional live rebuild, provenance, limitations, and Codex/GPT-5.6 use.
3. Automated checks cover evidence/citation validation, location scoping, and personalization reset behavior.
4. The one-command demo supports a complete Recent → evidence → Chat walkthrough without external dependencies.

## Requirement Coverage

| Phase | Requirements | Count |
|---|---|---:|
| Phase 1 | FOUND-01–05, LOC-03 | 6 |
| Phase 2 | LOC-01–02, LOC-04, RECN-01–04, PROD-01 | 8 |
| Phase 3 | ASK-01–05 | 5 |
| Phase 4 | CUR-01–04 | 4 |
| Phase 5 | PROD-02–04 | 3 |
| **Total** | **All v1 requirements** | **26 / 26** |

**Coverage:** 26 v1 requirements mapped exactly once; 0 unmapped; 0 duplicated.

---
*Created: 2026-07-18*
