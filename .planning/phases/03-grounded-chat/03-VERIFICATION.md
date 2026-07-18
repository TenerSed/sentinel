---
phase: 03-grounded-chat
verified: 2026-07-18T00:00:00-04:00
status: passed
score: 4/4
gaps: []
---

# Phase 3: Grounded Chat — Verification

## Verdict: PASSED

Phase 3 delivers a no-key grounded Chat path without weakening Lamplighter's existing source, coverage, or provenance boundaries. Both the server and browser independently accept only application-issued evidence IDs from the active coverage packet; the provider never supplies a URL or source record to the UI.

## Roadmap success criteria

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Chat accepts supported civic questions for selected coverage and retrieves only configured-source evidence. | VERIFIED | `buildPacket()` opens the committed SQLite database read-only, queries only a known coverage, then calls `projectEvidenceForLocation(...).slice(0, 6)`. The browser forms the same location-derived packet and sends only `coverageId` plus question. |
| 2 | GPT-5.6 receives a closed packet and its structured output is locally validated against stored evidence IDs. | VERIFIED | `server/chat.mjs` sends a JSON-schema constrained OpenAI Responses request containing only record IDs and stored fields. `validateGroundedAnswer()` rejects malformed/multi-sentence blocks and IDs outside the packet before any result is returned; `src/App.tsx` repeats validation against its active packet. |
| 3 | Supported answers render citation chips that open the shared evidence panel. | VERIFIED | `AnswerView` renders a button immediately after every answer block citation ID; its handler sets the existing `selectedId`, which drives the unchanged stored-quote/detail panel and canonical source action. |
| 4 | Unsupported, uncited, or invalid output produces an explicit insufficient-evidence response. | VERIFIED | Invalid/unknown/empty citations, malformed output, no matching preset, candidate-position requests lacking a tagged direct statement, terminal provider failures, and no configured provider all become the fixed `I can’t answer that from the selected public records yet,` state. |

## ASK requirement audit

| Requirement | Status | Evidence |
|---|---|---|
| ASK-01 | VERIFIED | Chat replaces the unavailable bottom-nav tab; it uses the active coverage selector, offers five scoped suggestions and free text, preserves location-separated local threads, and includes seven packet-bound bundled answers across the three configured coverages. |
| ASK-02 | VERIFIED | `answerQuestion()` constructs the server-owned packet from read-only SQLite; neither the POST body nor client code can submit evidence IDs, URLs, source lists, or provider selection. Coverage/source membership is inherited from the verified `projectEvidenceForLocation()` query. |
| ASK-03 | VERIFIED | OpenAI uses strict JSON Schema; Anthropic/Gemini receive the same schema via server-only native `fetch`. All three result paths reach the same local answer validator. The contract test proves forged and cross-coverage IDs, multi-sentence blocks, malformed objects, and missing citations refuse. |
| ASK-04 | VERIFIED | Citation chips contain only a locally resolved source title/locator and route into the existing provenance panel. The provider response has no accepted URL, title, locator, HTML, or Markdown field. |
| ASK-05 | VERIFIED | The exact refusal copy is rendered for insufficient answers. Candidate/office-holder positions are preflighted on both client and server and require a `recent_public_position` record. Current fixture packets contain no such tag, so party/vote/affiliation inference cannot reach a provider. |

## Provider, persistence, and expansion-boundary audit

- The server tries configured providers in order: OpenAI/GPT-5.6, Anthropic, Gemini. Missing keys produce `skipped`; only timeout, connection/network, `408`, `429`, and `5xx` outcomes continue to the next provider. Invalid schema/output, insufficient answers, unknown citations, and other `4xx` failures are terminal and never fall through.
- Browser code contains no provider keys or provider endpoint URLs. The built client was searched for provider key names/server imports and contains none. `/api/chat/status` returns only availability; successful live turns disclose the returned provider name, while failures disclose only provider plus compact error type.
- No-key mode is truthful: it shows Live AI unavailable yet resolves only exact, location-scoped bundled presets marked `Bundled demo answer`; arbitrary and cross-location prompts refuse.
- Stored threads contain rendered question/answer blocks and issued IDs only. `validStoredThreads()` revalidates every turn against the current coverage packet before displaying it, so a forged or stale cross-coverage local-storage turn is discarded.
- The refusal-only `Find more sources` control toggles static explanatory text. It does not fetch, import, change coverage, mutate the seed, or substitute reporting. There is no hidden source-search route in the Chat request path.
- Differing claims remain separately cited blocks under the provider instruction; the UI makes no winner/merging inference.

## Checks run

```text
npm run validate:contract  # passed
npm run validate:seed      # passed
npm run validate:recent    # passed
npm run validate:import    # passed
npm run validate:chat      # passed (20 cases)
npm run build              # passed
git diff --check           # passed
```

No-key runtime smoke test on the local server passed:

```text
GET  /api/chat/status                                      -> { live: { available: false, providers: [] } }
POST /api/chat (Indianapolis candidate-position question)  -> insufficient, six-record packet metadata
POST /api/chat (federal arbitrary question)                -> insufficient, four-record packet metadata
```

The packet cap is six records; the federal fixture currently has four eligible records, accurately reported as four rather than padded or broadened.
