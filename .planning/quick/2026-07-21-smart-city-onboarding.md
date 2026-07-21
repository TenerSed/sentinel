# Quick Task: Smart City Onboarding

## Goal

Ship a live demo path that proposes civic vendor identifiers, verifies them with HTTP evidence, discovers ArcGIS parcel services, and ingests verified meetings idempotently into SQLite.

## Scope

- Add `server/onboard.mjs` with discovery and ingestion handlers.
- Register `/api/onboard/discover` and `/api/onboard/ingest` in `server/app.mjs`.
- Add a shell-mounted `/onboard` page with examples, live checklist presentation, evidence, and ingest controls.
- Link onboarding from the primary navigation and landing page.
- Verify the production build and the three required live API calls without committing.

## Guardrails

- OpenRouter may only propose candidates; code alone marks sources verified.
- Every verified source must have a successful live HTTP response and captured evidence.
- Failed proposals remain visible as unverified attempts with honest reasons.
- Video discovery is optional and must never delay the core path.
- Preserve all unrelated dirty-worktree changes.

## Verification

- `npm run build`
- San Jose, CA discovery verifies Legistar and ArcGIS.
- Carmel, IN discovery verifies CivicClerk.
- San Jose Legistar ingestion returns a real count and three sample names.

## Result

Completed 2026-07-21. The production build passes; San Jose verified Legistar plus four parcel services, Carmel verified CivicClerk plus one parcel service, and San Jose ingestion stored 4,652 distinct meeting events idempotently.
