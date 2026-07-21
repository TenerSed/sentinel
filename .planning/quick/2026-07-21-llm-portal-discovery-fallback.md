# Quick Task: LLM Portal Discovery Fallback

## Goal

Keep onboarding discovery fast for cities whose portal slug is guessable, and add a code-verified
LLM fallback for cities where the deterministic pattern probes all miss.

## Scope

- Reorder discovery: deterministic pattern probes (CivicClerk + Legistar) run first, no LLM cost.
- Only when no meetings source verifies, call OpenRouter `deepseek/deepseek-v4-flash:online`
  with reasoning disabled for up to five strict-JSON portal candidate URLs.
- Recognize vendors from candidate URLs (CivicClerk, Legistar, PrimeGov probeable; Granicus,
  NovusAgenda, eSCRIBE, IQM2, CivicPlus, CivicWeb, BoardDocs recognized but not probeable).
- Code-probe every recognized candidate; the LLM is never trusted, only its guesses are.
- Report discovery metadata (mode, probe counts, LLM usage/reason, elapsed ms) and per-source evidence.
- Cache the verified discovery result per city; recompute ingest counts on cache hit.
- Preserve unrelated working-tree changes and make no git commit.

## Verification

- Raleigh NC, San Jose CA, Fishers IN verify on the pattern path (no LLM call).
- Austin TX misses the pattern path and verifies via the LLM fallback (`austintexas` Legistar).
- `npm run build` passes.

## Guardrails

- No vendor slug is ever reported verified without a live code probe returning a real event sample.
- Missing `OPENROUTER_API_KEY` degrades to pattern-only discovery, never an error.
- LLM candidates are capped at five and URL-parsed before use.
- No commits.

## Result

Implemented in `server/onboard.mjs`. `npm run build` passes. Live verification found Raleigh's
eScribe portal and Austin's Legistar tenant through web search, while San Jose and Fishers stayed
on the fast pattern path with search skipped. Verified city results are cached in `app_cache`.
