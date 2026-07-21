# Quick Task: Interactive Onboarding Map

## Goal

Replace the onboarding city-list chooser with an interactive U.S. Leaflet map that reverse-geocodes arbitrary clicks server-side, while retaining free-text entry and the existing discovery/checklist/ingest flow.

## Scope

- Add a cached `GET /api/onboard/locate?lat=&lng=` handler using Nominatim with Census fallback.
- Pass an optional resolved county into discovery and use it for the ArcGIS parcel query.
- Reuse the existing Leaflet/OSM stack for click selection, quick-reference pins, confirmation, loading/error states, and text fallback.
- Preserve unrelated working-tree changes and make no git commit.

## Verification

- San Jose coordinates resolve to San Jose / Santa Clara County / CA.
- Fishers coordinates resolve to Fishers / Hamilton County / IN.
- Discovery receives city, state, and county after map confirmation.
- `npm run build` passes.

## Guardrails

- No hardcoded supported-city list or dropdown; reference locations are map shortcuts only.
- Provider requests remain server-side and Nominatim receives a descriptive User-Agent.
- Unknown/ocean points return a clear client-safe error.
- No commits.

## Result

Completed 2026-07-21 without committing. Both required coordinates resolved through Nominatim and were stored in `app_cache`; an ocean point returned the stable `no_municipality` error; county-aware San Jose discovery searched `parcels Santa Clara County CA` and verified live ArcGIS Feature Services; the production build passed.
