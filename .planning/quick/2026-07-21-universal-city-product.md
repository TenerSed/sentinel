# Quick Task: Universal City Product

## Goal

Make Sentinel city-neutral by default, retain Fishers, IN as the clearly labeled fully indexed reference city, and prevent reference-city data from being presented as belonging to newly onboarded cities.

## Scope

- Extend the existing auth/profile context into the single selected-city store with localStorage and Supabase profile persistence.
- Add universal header identity, city switching, no-city landing, selected-city dashboards, and honest city-scoped coverage states.
- Gate deep Fishers-only pages behind explicit reference-city messaging without changing their routes.
- Update README language and verify a production build without committing.

## Guardrails

- No LLM calls in request paths; retain OpenRouter only where onboarding discovery already uses candidate proposals.
- Never label Fishers counts or cases as another city's data.
- Preserve Tracker, Map, Case, Analysis, and Graph behavior for Fishers.
- Do not commit and do not disturb unrelated worktree changes.

## Verification

- `npm run build`
- No selected city: neutral header and city-selection landing.
- San Jose selected: city header and honest 4,652-meeting shallow-ingestion state, with no Fishers case counts.
- Fishers selected: complete dashboard and reference-city deep-data pages remain available.

## Result

Completed 2026-07-21 without committing. The production build passes. The selected-city store persists locally and attempts full profile synchronization for signed-in residents; the no-city landing is neutral; San Jose resolves to its 4,652 ingested meetings without mounting Fishers case data; and Fishers retains the fully indexed dashboard and deep-data routes behind explicit reference-city labels.
