# Phase 4: Curated - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 4-Curated
**Areas discussed:** Signals and privacy, Ranking, Curated experience, Reset and transparency

---

## Signals and privacy

| Decision | Selected |
|---|---|
| Signal order | Chat question > copied citation > qualified Recent open |
| Retention | Local until reset |
| Chat data for ranking | Topic tags + timestamp, no raw question |
| Recent event | One signal after 10 seconds |

## Ranking

| Decision | Selected |
|---|---|
| Retrieval | Precomputed embeddings + local cosine ranking |
| Profile | Activity-linked updates plus editable civic topics |
| Cold start | Newest eligible starter view |
| Document RAG | Explicitly out of scope; rank surfaced update records only |

## Curated experience

| Decision | Selected |
|---|---|
| Layout | Reuse Recent rows and evidence panel |
| Explanation | Topic, action type, and recency |
| Topic editing | Chips + Add topic inside Curated |
| List length | All eligible ranked updates |

## Reset and transparency

| Decision | Selected |
|---|---|
| Reset scope | Signals + topics only; preserve Chat history |
| Reset interaction | Confirmation dialog + success message |
| Detail level | Why-this lines + local-only note |
| Reset view | Newest-first starter view |

## the agent's Discretion

- Deterministic embedding, score, topic-normalization, and storage details within the locked privacy boundary.

## Deferred Ideas

- Account/settings tab, explicit evidence expansion, and provider conversational memory.
