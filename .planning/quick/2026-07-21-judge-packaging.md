# Quick Task: Judge Packaging

## Goal

Ship a clone-and-run cached demo that uses a slim SQLite database and does not require Docker, Neo4j, API keys, or the raw 194 MB extraction database.

## Scope

- Add a reproducible `build:demo-db` script containing the complete runtime cache, referenced parcels plus a bounded address sample, and the small onboarding table.
- Select `SENTINEL_DB`, `data/fishers.db`, or `data/demo.db` in that order and log the selected database once.
- Make the optional Analysis and Graph graph dependency visibly and honestly offline without disrupting cached pages or onboarding.
- Add judge-first README instructions and ensure `data/demo.db` can be tracked.
- Preserve existing working-tree changes and make no commit.

## Verification

- Run `npm run build:demo-db` and record the final size.
- With `SENTINEL_DB=data/demo.db` and Neo4j unavailable, confirm 200 responses with real data from stats, cases, map cases, flagship case details, address lookup, and corpus insights.
- Confirm the flagship case retains quotes and receipts.
- Run `npm run build`.

## Guardrails

- Do not copy raw document plaintext, transcript cues, full parcel data, Docker state, or Neo4j data into the demo database.
- Do not commit.
