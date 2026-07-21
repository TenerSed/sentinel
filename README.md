# Sentinel — Resident Ally

**The intelligence developers pay lobbyists for—free for the residents they build next to.**

Sentinel turns hard-to-use local-government records into a resident-facing civic intelligence product. Start with a city or address, then inspect nearby land-use cases, applicants, representatives, public opposition, outcomes, and the primary-record receipts behind each claim.

Fishers, Indiana is the fully indexed reference city. Other cities can be discovered and onboarded, but Sentinel is explicit about the difference between verified source coverage and a deeply extracted civic graph: it never silently substitutes Fishers data for another place.

## What it does

- Connects a resident-facing address to parcels, zoning, and nearby development cases.
- Shows case dossiers with applicants, representatives, precedent, documented public comment, outcomes, and links back to source material.
- Preserves page-level document evidence and timestamped meeting-video cues.
- Provides a map, tracker, civic-analysis terminal, and graph explorer over the reference corpus.
- Supports optional Supabase accounts to save a resident profile and tracked cases across devices; browsing public records remains available without an account.
- Uses a committed SQLite demo database and cached responses so the core demo does not depend on a live model call or a live graph database.

## Trust model

Sentinel is not a generic chatbot over civic content.

- Public records, SQL, and Cypher are the authority for facts, counts, entities, and relationships.
- Every meaningful claim should resolve to a public-document page or video timestamp.
- The app leaves unavailable data visible rather than filling gaps with plausible claims. For example, it does not infer individual vote direction when the source does not provide it.
- Model output is constrained to extraction or wording of supplied facts; it does not decide what happened in the public record.

## Run locally

### Requirements

- Node.js 18+
- A Supabase project for the current account/profile UI

### Start the demo

```bash
git clone https://github.com/TenerSed/sentinel.git
cd sentinel
npm install
cp .env.example .env
```

Add these browser-safe Supabase values to `.env` (or `.env.local`):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Then run:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The included `data/demo.db` provides the offline reference-data path. Neo4j, public-record ingestion, and model-backed extraction are optional rebuild tooling—not prerequisites for the core local demo.

### Useful commands

```bash
npm run build
npm run demo
npm run validate:contract
npm run validate:seed
npm run validate:chat
npm run validate:curated
npm run ingest:all
npm run graph:up
npm run graph:all
```

`npm run ingest:all` fetches Fishers source material into the local SQLite extraction database. `npm run graph:all` builds the deterministic Neo4j backbone; model extraction is a separate, optional step described in [scripts/graph/README.md](scripts/graph/README.md).

## Demo path

For the shortest walkthrough:

1. Open `/` and choose Fishers, IN—the fully indexed reference city.
2. Search an address or open a nearby case.
3. Follow a case dossier to its supporting document or meeting-video receipt.
4. Open `/terminal` to inspect computed patterns and entity dossiers.
5. Open `/graph` to show the structured and open-schema civic graph.

See [DEMO.md](DEMO.md) for the timed three-minute narration.

## Architecture

```text
CivicClerk + public meeting video + parcels + zoning GIS
                         |
                  ingestion scripts
                         |
            SQLite source/extraction database
                         |
      deterministic graph backbone + optional LLM extraction
                         |
                  Neo4j civic graph
                         |
           precomputed SQLite snapshot/cache
                         |
               Node server + Vite React UI
```

The graph uses a constrained civic schema for core entities such as `Case`, `Person`, `Organization`, `Parcel`, `ZoningDistrict`, `Meeting`, and `Document`. An open-schema extraction layer can retain important concepts that do not fit the fixed ontology, but each extracted entity remains grounded to its source document.

## How we used GPT-5.6

GPT-5.6 is an optional, bounded part of the offline pipeline—not the authority behind resident-facing facts.

- **Provenance-linked extraction:** with `LLM_PROVIDER=openai` and `OPENAI_MODEL=gpt-5.6`, the graph extractor processes document or transcript chunks into strict JSON entities and relationships. It only permits the civic labels and relationships the application recognizes, and records source IDs plus character offsets or video times.
- **Open-schema discovery:** a separate extraction pass captures civic concepts that the fixed graph schema cannot anticipate, while grounding every emitted entity back to a source document.
- **Explicit decision extraction:** the minutes pass extracts only stated agenda outcomes, vote tallies, movers, seconders, and documented opposition.
- **Fact-bounded narration:** when enabled for offline snapshot work, model prompts receive computed fact packets and must only rephrase supplied names, numbers, and case identifiers. The normal demo request path does not wait on a model call.

Structured outputs, checkpointed extraction logs, source locators, and deterministic SQL/Cypher checks are the guardrails. Sentinel prefers a missing fact to a model-generated one.

## How we used Codex

Codex accelerated the build while the product team retained the important civic and product decisions: which public records to trust, the evidence-first rule, Fishers as the reference city, the graph schema, and what the demo should prove.

Codex was used to:

- Scaffold and iterate the Node/Vite application, data contracts, and demo-safe cache path.
- Build and refactor the ingestion adapters for CivicClerk records, public YouTube captions, parcel data, and zoning GIS.
- Implement the provenance-carrying graph pipeline, extraction schemas, checkpointing, validation scripts, and deterministic fallback behavior.
- Build the resident dashboard, case dossier, map, tracker, terminal, graph explorer, and source-aware empty/failure states.
- Add Supabase authentication/profile plumbing and iterate on responsive, keyboard-accessible UI states.
- Run type checks, build checks, source-contract checks, and targeted regression scripts as the implementation evolved.

The model and Codex were used to make the pipeline and interface faster to build; the project’s credibility still comes from public records, explicit source links, and deterministic verification.

## Limitations

- Fishers is the only deeply indexed reference city in the bundled demo.
- The public CivicClerk API does not expose complete structured agenda-item or per-member vote-direction data.
- Some public PDFs are scanned and require OCR before they can be fully extracted.
- Entity resolution can still leave duplicate people or organizations across inconsistent public records.
- The map only renders cases whose parcels resolve to usable geometry.
- Supabase profile synchronization requires a configured project and the expected `profiles` table; the UI falls back to local browser storage if that table is unavailable.

## Source considerations

Government records are public but may be corrected, removed, delayed, incomplete, or published in inaccessible formats. Sentinel labels its reference-city depth, retains source attribution, and does not treat a missing public record as proof that something did not happen.

## License

MIT. See [LICENSE](LICENSE).
