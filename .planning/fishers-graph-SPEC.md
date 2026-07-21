# Fishers Civic Knowledge Graph — Build SPEC

Build an LLM-driven knowledge graph in **Neo4j** from the already-extracted `data/fishers.db`, inspired by neo4j-labs/llm-graph-builder (ontology-constrained entity/relationship extraction with provenance). Land-use / rezoning / variance intelligence for Fishers, IN.

## Guiding principles
- **Backbone is deterministic; LLM is only for text.** Meetings, Parcels, Zoning districts are already structured in `fishers.db` — load them into Neo4j directly (no LLM). Use the LLM ONLY to extract entities/relations that live in unstructured text (Minutes, Agenda Packets, YouTube transcripts): cases, people, organizations, applicants/attorneys, motions/votes, rezone from→to.
- **Provenance on everything.** Every node and relationship the LLM produces stores: `source` (e.g. `minutes`,`packet`,`transcript`), `source_id` (cc_files.file_id / event_id / video_id), and a locator (`char_start`/`char_end` for text, `start_seconds` for video). The graph must be citation-grounded — no ungrounded claims.
- **Ontology-constrained.** The LLM may only emit node labels and relationship types from the schema below; anything else is dropped at load. Single source of truth: `scripts/graph/schema.mjs`.
- **Idempotent.** All writes use Cypher `MERGE` on stable keys. Re-running must not duplicate.
- **Provider-abstracted + key-optional.** LLM calls go through `scripts/graph/lib/llm.mjs`, provider chosen by `LLM_PROVIDER` (`gemini` default, `openai` fallback). A `--dry-run` mode uses a deterministic regex mock extractor so the ENTIRE pipeline (including Neo4j load) can be built and verified WITHOUT any working LLM key.
- **Free-tier aware.** Gemini free tier is low-RPM: throttle to ≤10 req/min, exponential backoff on 429, checkpoint progress in SQLite so a killed run resumes.

## Infra — Neo4j via Docker
- `docker-compose.graph.yml`: service `neo4j` on image `neo4j:5-community`, ports 7474 (http) + 7687 (bolt), env `NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}`, `NEO4J_PLUGINS=["apoc"]`, named volume `fishers_neo4j_data`, healthcheck on 7474.
- `.env` (gitignored) adds: `NEO4J_URI=bolt://localhost:7687`, `NEO4J_USER=neo4j`, `NEO4J_PASSWORD=fishers-graph-dev`, `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=...` (already present), `GEMINI_MODEL=gemini-2.0-flash`, optional `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.6`.
- npm scripts: `graph:up` (docker compose -f docker-compose.graph.yml up -d), `graph:down`, `graph:constraints`, `graph:backbone`, `graph:extract`, `graph:all`, `graph:query`.
- Use the `neo4j` npm driver (add dependency). Node ESM `.mjs` under `scripts/graph/`.

## Ontology (schema.mjs — single source of truth)

**Node labels + key property (MERGE key):**
- `Meeting` — key `event_id`. props: board (category_name), date, name, youtube_video_id.
- `Case` — key `case_number` (normalized ordinance/resolution/docket/variance id, e.g. `RZ-2026-0012`, `2026-0034`). props: case_type (`rezoning`|`variance`|`PUD`|`plat`|`special_exception`|`other`), title, status/outcome, raw_number.
- `Parcel` — key `parcel_no` (FMTPRCLNO). props: address, owner_name, prop_class, acreage, av_total_gross, property_report_url.
- `ZoningDistrict` — key `code` (AG, C3, PUD, overlay name). props: name, kind (`district`|`overlay`), ordinance_url.
- `Person` — key `name_normalized` (lowercased, punctuation-stripped). props: name, roles (array: `council_member`|`board_member`|`applicant`|`attorney`|`staff`|`speaker`|`petitioner`).
- `Organization` — key `name_normalized`. props: name, org_type (`llc`|`developer`|`law_firm`|`company`|`hoa`|`other`).
- `Document` — key `doc_id` (`file:{fileId}` or `video:{videoId}`). props: source, title, url.

**Relationship types (with provenance props on each):**
- `(Case)-[:HEARD_AT]->(Meeting)`
- `(Case)-[:CONCERNS]->(Parcel)`
- `(Case)-[:REZONE_FROM]->(ZoningDistrict)` and `(Case)-[:REZONE_TO]->(ZoningDistrict)`
- `(Person|Organization)-[:APPLICANT_FOR]->(Case)`
- `(Person)-[:REPRESENTS]->(Person|Organization)`  (attorney→applicant)
- `(Person)-[:SPOKE_AT {start_seconds}]->(Meeting)`
- `(Person)-[:MADE_MOTION {text, outcome}]->(Case)` and `(Person)-[:VOTED {value}]->(Case)`  (value ∈ aye|nay|abstain|absent)
- `(Parcel)-[:CURRENTLY_ZONED]->(ZoningDistrict)`  (deterministic if parcel zoning known; else from text)
- `(Parcel)-[:OWNED_BY]->(Person|Organization)`
- `(Meeting)-[:HAS_DOCUMENT]->(Document)`
- `(Case)-[:EVIDENCED_BY]->(Document)`

Every LLM-produced relationship also carries: `source`, `source_id`, `char_start`, `char_end` (or `start_seconds`), `confidence` (0–1), `extractor` (`llm:<model>` or `mock`).

**Constraints (graph:constraints):** unique constraint on each node label's key property; that also creates the index. Run once before loads.

## Backbone loader (backbone.mjs — NO LLM)
Read from `data/fishers.db`, MERGE directly:
- `cc_events` → `Meeting` nodes (all 184).
- `cc_files` → `Document` nodes + `(Meeting)-[:HAS_DOCUMENT]->(Document)`.
- `parcels` → `Parcel` nodes (all 38,915). Also MERGE `Organization`/`Person` owner from `owner_name` (heuristic: contains LLC/INC/TRUST/LP → Organization, else Person) + `(Parcel)-[:OWNED_BY]->()`.
- `zoning_districts` → `ZoningDistrict` nodes (35).
Print node/rel counts. This must succeed with zero LLM usage and is the demo floor.

## Extraction (extract.mjs — LLM or --dry-run mock)
For each text unit — `cc_files.plaintext` (Minutes + Agenda Packet), and `yt_transcript_cues` grouped per video into ~1-2k-token windows with their `start_seconds`:
1. **Chunk** the text (~1500 tokens, 150 overlap). Skip empty.
2. **Extract** via `llm.extract(chunk, ontology, contextHints)`:
   - `contextHints` = the Meeting's board+date and any Parcel addresses already known, to help resolution.
   - Structured output constrained to the ontology (Gemini `responseSchema` / OpenAI Structured Outputs). Return `{nodes:[{label,key,props}], relationships:[{type,from:{label,key},to:{label,key},props}]}`.
   - Prompt instructs: extract ONLY entities/relations explicitly supported by the text; attach the exact quoted span; do NOT invent case numbers, votes, or names; prefer omission over guessing (matches project's evidence rule).
3. **Normalize + resolve**: normalize person/org names, case numbers; map to MERGE keys; drop nodes/labels not in ontology.
4. **Load** to Neo4j via MERGE with provenance props; MERGE the `Document` and add `(Case)-[:EVIDENCED_BY]->(Document)`.
5. **Checkpoint** each processed (source_id, chunk_ordinal) into a `graph_extract_log` SQLite table so re-runs resume and don't re-spend tokens.

**--dry-run mock extractor** (`lib/mock-extract.mjs`): deterministic, no network. Regex out ordinance/resolution numbers (`Ordinance No. 2026-xx`, `Docket ... `, `RZ-...`, `PUD ...`), zoning codes (`from AG to C3`), and obvious names near "petitioner/applicant/attorney/moved by/seconded by". Emits the same JSON shape so the load path is fully exercised. Used to verify Neo4j loading + graph shape before the real LLM key is available.

## Provider abstraction (lib/llm.mjs)
- `LLM_PROVIDER=gemini`: POST `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}` with `generationConfig.responseMimeType=application/json` + `responseSchema`. Handle 429 (`RESOURCE_EXHAUSTED`) with backoff; if the error says `limit: 0` (free tier not granted), FAIL FAST with a clear message telling the user the key has no free-tier quota (enable billing or use an AI Studio key / set LLM_PROVIDER=openai).
- `LLM_PROVIDER=openai`: OpenAI Responses API with Structured Outputs, model `OPENAI_MODEL`.
- Both return the parsed, schema-valid object. One helper, swappable, no framework.

## Sample queries (graph:query — proves the graph)
Print results of 3 Cypher queries:
1. Rezoning cases with their parcel + from/to district: `MATCH (c:Case)-[:CONCERNS]->(p:Parcel), (c)-[:REZONE_FROM]->(a), (c)-[:REZONE_TO]->(b) RETURN c.case_number,p.address,a.code,b.code LIMIT 20`.
2. A board member's voting record: `MATCH (person:Person)-[v:VOTED]->(c:Case) RETURN person.name, c.case_number, v.value LIMIT 20`.
3. Everything grounding one case: `MATCH (c:Case)-[:EVIDENCED_BY]->(d:Document) RETURN c.case_number, collect(d.title)`.

## Acceptance (Codex verifies)
1. `npm run graph:up` starts Neo4j; wait for healthy; `graph:constraints` creates constraints.
2. `npm run graph:backbone` loads 184 Meetings, 35 ZoningDistricts, 38,915 Parcels + owner/doc rels with zero LLM calls. Print counts via Cypher.
3. `npm run graph:extract -- --dry-run --limit=20` runs the mock extractor over 20 text units and MERGEs Case/Person/vote nodes+rels with provenance. Print new counts. Proves the load path end-to-end with NO LLM key.
4. `graph:query` prints non-empty results for at least query #3 after the dry-run.
5. If a working LLM key is present, `npm run graph:extract -- --limit=5` performs real extraction on 5 units and lands ≥1 Case with `EVIDENCED_BY`. If the key is `limit:0`, the run must fail fast with the clear quota message (not hang, not silently write nothing).
6. `scripts/graph/README.md` documents: docker/neo4j setup, the ontology, provider config, the dry-run path, and the LLM-key requirement/limitation.

Do not commit (sandbox blocks .git). Keep secrets in .env only. Small, dated conventional commits are NOT required here since git is blocked; just leave a clean working tree.
