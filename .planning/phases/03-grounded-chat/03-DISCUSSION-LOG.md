# Phase 3: Grounded Chat - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 3-Grounded Chat
**Areas discussed:** Answer mode, Chat experience, Citations and refusal, Model safety

---

## Answer mode

| Decision | Selected |
|---|---|
| No-key behavior | Live AI unavailable plus cited bundled demo questions |
| Provider order | GPT-5.6, then configured Anthropic, then configured Gemini |
| Failover | Outage, timeout, or rate limit only |
| Live disclosure | Actual active provider per answer |
| Offline disclosure | `Bundled demo answer` |
| Presets | Five or more evidence-backed questions |

**Notes:** Unconfigured fallback keys are skipped. Static answers cannot claim an AI provider generated them.

---

## Chat experience

| Decision | Selected |
|---|---|
| Evidence scope | Active Recent coverage |
| History | Browser local storage |
| Location change | Separate visible thread |
| Composer | Five location-aware suggestions plus free text |

---

## Citations and refusal

| Decision | Selected |
|---|---|
| Citation placement | After every factual sentence or bullet |
| Answer format | Direct answer plus details when useful |
| Insufficient evidence | Clear refusal plus suggestions |
| Source disagreement | Show both cited claims; choose no winner |

---

## Model safety

| Decision | Selected |
|---|---|
| Output contract | Structured blocks with application-issued evidence IDs |
| Provider packet | Small deterministic selected-location subset |
| Invalid output | Insufficient-evidence response; never show invalid text |
| Limits | Response-length cap only |
| Candidate positions | Explicit recent public statement only |
| Future source search | Visible but non-functional Phase 3 affordance |

## the agent's Discretion

- Exact server adapter shape, structured schema, deterministic packet size, answer cap, presets, and storage key shape within the locked boundaries.

## Deferred Ideas

- Explicit evidence-expansion search/refresh flow, including clearly labeled reporting after configured government sources.
- User-selected provider/model choice.
