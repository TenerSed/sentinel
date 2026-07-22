# Sentinel — Resident Ally

**The intelligence developers pay lobbyists for—free for the residents they build next to.**

Sentinel makes local-government land-use records usable. Enter an address to trace nearby parcels, zoning cases, applicants, representatives, public opposition, and outcomes—each claim links back to a document page or meeting-video timestamp.

Fishers, Indiana is the bundled, deeply indexed reference city. Other cities can be discovered and onboarded, but Sentinel distinguishes verified source coverage from a fully extracted civic graph; it never presents Fishers data as another place.

## Judge demo

- Live demo: [sentinel-production-d857.up.railway.app](https://sentinel-production-d857.up.railway.app)
- Reference corpus: committed `data/demo.db`, `data/lamplighter.db`, and public-record source material in `data/raw/`
- No OpenAI, Neo4j, or ingestion key is required to browse the bundled Fishers demo. The deployed and local UI do require the browser-safe Supabase variables below for account initialization.

For the shortest path, choose Fishers, search an address, open the Story Cottage case, then inspect its receipt, map, terminal, and graph. [DEMO.md](DEMO.md) contains the timed three-minute walkthrough.

## Run locally

Requires Node.js 18+ and a Supabase project for the current email/password account UI.

```bash
git clone https://github.com/TenerSed/sentinel.git
cd sentinel
npm install
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Use only the **publishable** Supabase key; never add a service-role key to a `VITE_*` variable.

For Railway: build with `npm ci && npm run build`, start with `node server/app.mjs --production`, and set `SENTINEL_DB=data/demo.db` plus the two `VITE_SUPABASE_*` variables at build time. Railway supplies `PORT`.

## What runs where

```text
public records + meeting video + parcels/zoning GIS
                        ↓
                 SQLite ingestion store
                        ↓
     deterministic graph backbone + optional GPT-5.6 extraction
                        ↓
         Neo4j graph + precomputed SQLite snapshot/cache
                        ↓
               Node server + Vite React interface
```

The normal demo serves its bundled SQLite data and does not wait for a model or Neo4j request. Neo4j and source ingestion are rebuild tooling; GPT-5.6 is used offline when configured.

Useful verification and rebuild commands:

```bash
npm run build
npm run validate:contract
npm run validate:seed
npm run validate:chat
npm run validate:curated
npm run ingest:all
npm run graph:backbone
npm run graph:extract
```

`graph:backbone` writes the deterministic graph. `graph:extract` is the optional model-backed extraction step; see [scripts/graph/README.md](scripts/graph/README.md).

## Evidence and model boundaries

- Public records, SQL, and Cypher determine facts, counts, entities, and relationships.
- Claims link to a public document page or video timestamp. Missing vote direction or other unavailable data remains visibly unavailable.
- The model may extract or phrase supplied evidence; it does not decide what occurred in the public record.

## How we used GPT-5.6 and Codex

GPT-5.6 powers bounded, offline provenance-linked extraction: it converts public-record chunks into structured graph facts, resolves inconsistent entity names, and drafts grounded wording only from verified evidence. Structured output, source locators, and deterministic SQL/Cypher checks reject unsupported claims.

Codex accelerated the ingestion adapters, civic graph pipeline, validation scripts, resident interface, and deployment. We made the key product decisions: the evidence-first rule, public sources to trust, Fishers reference scope, graph schema, and the demo flow. The project’s credibility comes from its public records and deterministic verification—not model narration.

## Limits

- Fishers is the only deeply indexed bundled city.
- Some government PDFs need OCR; public APIs may omit per-member vote direction.
- Entity resolution can leave duplicate people or organizations across inconsistent records.
- The map only renders cases with usable parcel geometry.
- Supabase profile sync expects a configured project and `profiles` table; its browser-safe URL/key are required by the current account UI.

## Submission notes

This repository contains the runnable app, bundled demo data, source material, setup instructions, and this account of Codex/GPT-5.6 use. The public demo video and `/feedback` Codex Session ID are submitted through Devpost.

## License

[MIT](LICENSE)
