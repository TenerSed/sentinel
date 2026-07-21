# Sentinel — Resident Ally

> **The intelligence developers pay lobbyists for — free, for the residents they're building next to.**

Sentinel is a multi-city civic-intelligence product that verifies the public systems used by any U.S. city, ingests what is available, and tells residents exactly how deep that city’s coverage goes. Fishers, Indiana is the fully indexed reference implementation—not the product identity or a silent fallback for other cities.

## The problem

A homeowner learns that something is being built nearby, then discovers the details are buried in a 200-page PDF posted three days before a 7 p.m. meeting. Developers and repeat applicants know the process, the people, and the history. Residents usually do not.

That information asymmetry is the product insight behind Sentinel. It connects an address to nearby cases, explains what a proposal means, shows who is behind it and their local track record, names documented support or opposition, and links every important claim back to a document page or meeting-video timestamp.

## Reference implementation

Fishers, IN is Sentinel’s fully indexed reference city. Its current corpus includes:

- 184 CivicClerk meetings and 167 text documents containing 20,416,646 characters
- 38,915 Hamilton County parcels
- 100 City of Fishers YouTube transcripts containing 72,063 timestamped cues
- 35 zoning districts and overlays
- A structured graph of `Case`, `Person`, `Organization`, `Parcel`, `ZoningDistrict`, `Meeting`, and `Document` records
- An open discovery layer with 61,796 `OpenEntity` nodes, 168,634 relationships, 4,488 distinct dynamic labels, and 75,659 `MENTIONED_IN` grounding edges
- 169 cases with a recorded outcome; boards approve approximately 81–86% of decided land-use cases
- Precomputed SQLite responses served in approximately 2–100 ms

## Why you can't just ask ChatGPT

A general chatbot has not read this local record. It cannot reliably cross-reference thousands of meeting documents, parcels, zoning records, and transcript cues; it may hallucinate a vote; and it gives a resident no receipt they can take to a public meeting.

Sentinel's moat is the ingestion pipeline, knowledge graph, and evidence grounding—not the model. **Every number is computed by Cypher or SQL.** The LLM only phrases facts it is supplied, cites case numbers, and never invents a result.

## Architecture

```text
CivicClerk + YouTube + parcels + zoning GIS
                    |
             ingestion scripts
                    |
          SQLite (data/fishers.db)
                    |
              LLM extraction
                    |
          Neo4j knowledge graph
                    |
       precomputed snapshot cache
                    |
            Node server + Vite UI
```

The structured graph supports dependable civic questions; the open/dynamic graph preserves concepts that do not fit a fixed schema. Grounding edges always lead back to the underlying public record.

City onboarding verifies CivicClerk, Granicus/Legistar, PrimeGov, and NovusAgenda meeting systems; Esri ArcGIS parcel/zoning services; and public YouTube meeting video. Newly connected cities display only their own verified and ingested totals. For example, the included onboarding database contains 4,652 San Jose, CA Legistar meetings, while Fishers-only cases, documents, video, and graph data remain explicitly labeled as reference-city data.

## Quickstart

### Prerequisites

- Node.js 18 or newer
- Docker with Docker Compose
- Poppler: `brew install poppler`
- `yt-dlp` installed in the project's `.venv`

Then run, in order:

```bash
npm install
cp .env.example .env
# Edit .env and add the credentials you intend to use.
npm run graph:up
npm run snapshot
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The judging bundle ships with a prebuilt snapshot cache in `data/fishers.db`, so `npm run snapshot` may be skipped for the fastest demo path. Rebuilding snapshots requires the already-ingested Fishers database and populated Neo4j graph; it does not re-ingest the public corpus. The app keeps live provider calls off the request path and serves precomputed results during the demo.

## Three-minute product tour

- [`/`](http://localhost:5173/) — resident home, address lookup, proof statistics, and record highlights
- [`/onboarding`](http://localhost:5173/onboarding) — choose any city, verify its public sources, and save the selected-city state
- [`/map`](http://localhost:5173/map) — interactive, status-colored land-use map
- [`/case?case=RZ-26-1`](http://localhost:5173/case?case=RZ-26-1) — flagship Story Cottage memory-care case, track records, public comment, and receipts
- [`/terminal`](http://localhost:5173/terminal) — professional civic terminal with dossiers, power map, and win rates
- [`/graph`](http://localhost:5173/graph) — structured and dynamic knowledge-graph explorer
- [`/feed`](http://localhost:5173/feed) — original cited civic feed

For a timed walkthrough, see [DEMO.md](DEMO.md).

## Limitations

- The public CivicClerk API does not expose structured agenda-item or vote-direction data, so per-member vote direction is unavailable.
- 169 cases have a recorded outcome; cases without one are not treated as approved or denied.
- One scanned minutes PDF still requires OCR.
- Person and organization entity resolution still contains duplicates.
- The map covers the 35 cases whose parcels resolve to geometry.

Sentinel prefers a missing answer over an invented claim.

## AI and build credit

This project was built with OpenAI Codex. OpenRouter is the only runtime model provider. Model work is limited to offline extraction and bounded onboarding candidate proposals; normal dashboard, case, map, tracker, analysis, and graph request paths use precomputed data. Cypher and SQL remain the authority for facts and counts.
