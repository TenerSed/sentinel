# Fishers civic knowledge graph

Run `npm run graph:up`, then `graph:constraints`, `graph:backbone`, and (once a working LLM key is configured) `graph:extract -- --limit=20`. Neo4j reads credentials only from `.env`; `graph:down` stops the local container.

The deterministic backbone loads Meetings, Documents, Parcels, owners, and Fishers zoning district/overlay geometry-derived records without model calls. The ontology permits `Meeting`, `Case`, `Parcel`, `ZoningDistrict`, `Person`, `Organization`, and `Document`, with only the constrained case, zoning, applicant, representation, speech, motion, vote, ownership, document, and evidence relationships in `schema.mjs`. Every deterministic or extracted node and edge records source, source ID, confidence, and extractor; text extraction additionally records character offsets or video seconds.

Extraction is live-model only (no mock). It supports Gemini, OpenAI, and OpenRouter: set `LLM_PROVIDER=openrouter`, keep `OPENROUTER_API_KEY` in `.env`, and use `OPENROUTER_MODEL=deepseek/deepseek-v4-flash`. Every chunk is checkpointed in the `graph_extract_log` table so runs resume and never re-spend tokens. Live extraction covers Minutes, Agenda Packets, and timestamped YouTube transcript windows; transcript-derived facts retain their window's first `start_seconds` locator. Gemini keys that report `limit: 0` (no free-tier quota) fail fast with directions to enable billing, use an AI Studio key, or configure OpenAI; they never silently skip extraction. The backbone (Meetings, Documents, Parcels, owners, zoning) loads fully without any model calls, so the graph is demo-ready before extraction runs.

`npm run graph:extract-open` is a separate open-schema pass. It writes model-chosen dynamic labels and relationship types on `:OpenEntity` nodes, records `extractor='llm-open'`, and grounds every emitted entity with `:MENTIONED_IN` links to its source Document. It uses the same Minutes, Agenda Packet, and timestamped transcript windows as the structured pass.

After `npm run dev`, visit [http://localhost:5173/graph](http://localhost:5173/graph) for a capped live visualization of the Neo4j structured and open layers.

Visit `http://localhost:5173/investigate` for Cypher-computed cross-document findings, precedent comparisons, and an address-based briefing. The server sends only computed fact packets to the configured LLM provider for wording; it never delegates counts or names to the model.

`npm run graph:decisions` is a focused, resumable Minutes pass. It extracts explicit agenda outcomes and vote tallies into `Case` properties and records per-file/chunk progress in `decisions_log`; use `--limit=1` for a single Minutes file.
