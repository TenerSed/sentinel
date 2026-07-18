# Phase 3: Grounded Chat — Pattern Mapping

**Mapped:** 2026-07-18
**Purpose:** Reuse the Phase 1/2 evidence path while adding the smallest closed-packet Chat flow.

## Existing seams to reuse

| Need | Closest existing code | Reuse seam |
| --- | --- | --- |
| Active coverage | `src/App.tsx` `coverageId`, `coverage`, `records` memos | Keep one coverage selector. Chat consumes the already-derived active coverage and starts a separate local thread when it changes. |
| Closed record contract | `src/types.ts` `EvidenceRecord`, `DemoSeed` | Build Chat packet and citation map only from these fields: ID, title/type/source/date, exact quote, locator. Never accept evidence from the browser/model. |
| Offline corpus | `src/demo-seed.ts` | Add bundled preset questions/answers beside the static browser-safe seed, or in one adjacent static module. They must use existing record IDs and the same answer shape as live output. |
| Citation/source view | `src/App.tsx` `selectedId` and `detail-panel` | Lift the detail panel into a reusable render/state seam or add an ID setter that lets a citation chip select the corresponding record. Do not make a second provenance UI. |
| Location behavior | `scripts/evidence-contract.mjs` `projectEvidenceForLocation`; `scripts/recent-scope-check.mjs` | Keep Indianapolis expansion and exact Indiana/federal selection intact. Chat packet ordering should mirror `publishedAt DESC, id ASC`. |
| Trust-boundary checks | `scripts/evidence-contract.mjs` `validateEvidence`; `scripts/validate-seed.mjs` | Add a small no-network chat validator/check that follows the same fail-loud Node-script style. |
| Error/empty states | `src/App.tsx` `SeedState`, `futureMessage`; `src/styles.css` state styles | Reuse simple inline status/failure messaging; do not add a toast library. |
| Responsive editorial layout | `src/styles.css` evidence grid, detail panel, bottom nav | Add Chat-specific CSS in the existing stylesheet; preserve the fixed three-tab bottom navigation. |

## Anticipated file changes

| File | Change | Why it belongs here |
| --- | --- | --- |
| `src/App.tsx` | Replace unavailable Chat action with a Chat screen, suggested prompts, composer, local per-coverage history, provider/status rendering, citation chips, and no-op `Find more sources` explanation. | It already owns navigation, coverage selection, seed validation, evidence selection, and the shared panel. |
| `src/types.ts` | Add the shallow browser-safe chat result/thread types (`AnswerBlock`, grounded result, turn/status) and possibly a safe preset type. | Existing types define all client contracts; keep one common answer shape for bundled/live output. |
| `src/demo-seed.ts` or `src/demo-chat.ts` | Supply 5+ normalized, location-aware bundled question/answer fixtures referencing only existing record IDs. | Keeps the no-key demo deterministic and avoids a second data source. Prefer a separate `demo-chat.ts` only if it makes `demo-seed.ts` materially harder to scan. |
| `src/styles.css` | Add minimal Chat/thread/composer/chip/status styles and mobile stacking. | Current project is manually styled in one stylesheet; no component library is warranted. |
| `scripts/chat-contract-check.mjs` | Assert packet coverage, bundled answers, citation allow-list enforcement, invalid-result refusal, and provider fallback classification with fakes. | One runnable no-network check matches existing scripts and AI-SPEC evaluation needs. |
| `package.json` | Add `validate:chat`; add only the official `openai` dependency if the selected server arrangement can actually execute it. | Makes the new trust-boundary test part of the normal verification path. |
| Server-only chat module/entrypoint (planner to choose) | Accept only coverage ID/question, re-derive packet from trusted data, call configured providers in fixed order, and validate before returning. | Required for secret isolation; the Vite client cannot host provider keys. Do not import it from `src/App.tsx`. |

## Data flow to preserve

```text
coverageId + question (client)
  -> server validates coverageId/question
  -> server re-derives eligible records from trusted corpus
  -> six newest records, issued evidence-ID allow-list
  -> bundled answer OR GPT-5.6 -> Anthropic -> Gemini (transient failures only)
  -> common answer validator
  -> client receives text + issued IDs, never URLs/locators from a provider
  -> citation chip selects existing record detail panel
```

- The React app currently derives `records` from the public seed; that is adequate for display but **not** authorization. The server path must repeat the coverage relation from trusted seed/SQLite data.
- A provider request carries the user question plus the closed packet only. Do not send persisted threads, raw source text, database contents, model/provider choice, or browser-provided record IDs.
- Every answered block must have non-empty text and at least one packet-issued ID. Unknown, cross-coverage, or uncited blocks become the fixed insufficient-evidence response before React sees content.
- The existing detail panel must render the stored `canonicalUrl`, exact quote, and locator. Provider payloads never generate links or citations directly.

## Concrete implementation seams

1. **Coverage helper:** Extract the `coverage`/`records` memo logic in `App.tsx` only if both Recent and Chat need it in different places. Otherwise retain it and derive `packetRecords = records.slice(0, 6)` for client display; the server independently repeats this logic.
2. **Evidence selection:** `setSelectedId(record.id)` is the smallest citation-chip integration. It preserves the existing source panel and avoids a special Chat modal.
3. **Thread storage:** A versioned `localStorage` key containing a record keyed by `coverageId` is enough. Parse defensively and drop malformed values; do not persist provider raw output or evidence bodies.
4. **Answer rendering:** One direct-answer block plus optional bullet blocks maps to the existing semantic HTML/CSS style. Render citations as accessible buttons named from existing `sourceTitle` and `locatorText`.
5. **Provider failure:** Return only a provider/error-class status (`OpenAI · rate limited`, for example) to the client. Treat malformed/uncited responses as ordinary insufficient evidence, not an exposed provider diagnostic or a fallback trigger.
6. **Preset matching:** Normalize whitespace/case and match explicit fixtures; arbitrary no-key input refuses. Do not build fuzzy matching, retrieval, or search for this demo.

## Constraints / non-patterns

- `scripts/import.mjs` is maintainer-only draft ingestion. Chat must not invoke it or surface draft records.
- `data/lamplighter.db` and the current seed script remain the authoritative preprocessed demo; no browser-side SQLite or seed rebuilding.
- The project is presently Vite-only (`vite` dev/preview) with no server route convention. The planner must choose the minimum separate Node/API serving seam and ensure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` are never bundled. A broad migration to Next.js is not a Phase 3 shortcut.
- No chat package, agent framework, vector/FTS retrieval, streaming, provider selector, or live evidence expansion is justified by the closed six-record demo packet.

## Verification anchors

- Reuse `npm run validate:contract`, `validate:seed`, `validate:recent`, and `validate:import` unchanged.
- New `validate:chat` should be fully offline and cover the AI-SPEC’s packet, preset, validator, and fallback cases.
- `npm run build` plus a bundle inspection should prove client code contains neither provider calls nor API-key literals.
- Manual demo path: select coverage → Chat → preset → citation chip → existing source panel → switch coverage → distinct saved local thread.

## Planner notes

The important new architectural decision is the minimal server-only endpoint/process compatible with the Vite baseline. Resolve it before implementation; all other work should reuse the current single-screen app and static evidence projection. The product must remain fully demonstrable without any provider key.
