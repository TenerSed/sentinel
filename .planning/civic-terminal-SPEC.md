# Civic Terminal — "Bloomberg Terminal for City Hall" (flagship SPEC)

A dense, pro intelligence terminal over the Fishers civic knowledge graph. Search any entity (Person / Organization / Case / Parcel / ZoningDistrict / Meeting) → get a power-map, an entity dossier with win-rate/prediction analytics, and a video/document EVIDENCE dock. Everything grounded; numbers from Cypher, language from the LLM, receipts from real minutes text + timestamped YouTube transcript cues.

## Aesthetic
Dark, dense, professional "terminal" feel (near-black background, high-contrast, compact type, subtle monospace for IDs/stats, tight panels). Distinct from the existing light app. Fast, keyboard-friendly.

## Layout (route: /terminal ; also link from the app + /graph)
- LEFT: universal search box + results list.
- CENTER: live power-map (force graph, react-force-graph-2d already installed) of the selected entity's ego-network; click a node to re-center.
- RIGHT: entity DOSSIER panel — header (name/type), key stats, analytics widgets, connections list.
- BOTTOM: EVIDENCE DOCK — the receipts: document snippets and, when available, an embedded YouTube clip at the exact timestamp.

## Reuse (do not rebuild)
- Neo4j driver + .env loading already in server/app.mjs; /api/graph and /api/graph/expand exist (expand returns connections + resolved evidence snippets). 
- server/insights.mjs has helpers (normalize, status, terminal, caseId, landUse, distance) + findings/predict/near + the narrate() provider abstraction (OpenRouter now; OpenAI GPT-5.6 via env for final). Reuse these.
- data/fishers.db (better-sqlite3): cc_files.plaintext (document evidence), yt_transcript_cues(video_id, start_seconds, text, sort_order) — 72k timestamped cues for VIDEO receipts, parcels for address/owner.

## Server endpoints (add to server/app.mjs, logic in a new server/terminal.mjs)

### GET /api/terminal/search?q=<str>&limit=20
Fuzzy search across node captions. Cypher over Case.case_number/title, Person.name, Organization.name, Parcel.address, ZoningDistrict.code, Meeting.board — CONTAINS (case-insensitive) on the relevant property. Return [{id, label, caption, sublabel}] (sublabel = a quick descriptor e.g. case status, or "12 cases" for a repeat player). Rank land-use cases and higher-degree nodes first.

### GET /api/terminal/entity?id=<elementId>
Return a full dossier: { node:{id,label,caption,props}, stats:[{label,value,tone?}], analytics:{...typed}, connections:[{type,direction,neighbor:{id,label,caption},confidence,source}], evidence:[{kind:'doc'|'video', title, snippet, url, videoId?, startSeconds?}], narrative:{summary} }.
Typed analytics by label (numbers via Cypher, never invented):
- Person: detect roles (has REPRESENTS => attorney; APPLICANT_FOR => applicant; VOTED/MADE_MOTION => official). For attorney/applicant compute over their land-use cases: total, decided (terminal status), approved, approval_rate, and the board base_rate for comparison (so we can say "4 of 4 decided vs 81% board avg"). List their cases w/ outcomes.
- Organization: same applicant analytics + the attorneys who REPRESENT them (network).
- Case: status, vote_ayes/vote_nays (from decisions pass), applicant, attorney, parcel (CONCERNS), rezone_from/rezone_to, linked opposition Sentiment (via Case.source_id = OpenEntity:Sentiment.source_id), and a prediction (reuse insights.predict logic: base rate over comparable decided land-use cases + cited precedents).
- Parcel: address, owner (OWNED_BY), zoning, related cases (CONCERNS).
- Meeting: board, date, cases heard, documents.
- narrative.summary: ONE call to narrate() with the computed facts → a 2-3 sentence Bloomberg-style brief that only phrases supplied facts and cites case_numbers. Graceful: if the LLM fails, fall back to a templated summary from the facts.
- EVIDENCE resolution:
  - doc: reuse the /api/graph/expand approach — for the entity's key case_numbers, find EVIDENCED_BY/HAS_DOCUMENT Documents; pull a ~300-char snippet from cc_files.plaintext (search for the entity/case name).
  - video: search yt_transcript_cues for a cue whose text CONTAINS the entity's name or a linked case_number (case-insensitive; pick the earliest strong match). Return videoId + startSeconds + the cue text as snippet + url = https://www.youtube.com/watch?v=<videoId>&t=<Math.floor(startSeconds)>s . The client embeds https://www.youtube.com/embed/<videoId>?start=<sec>. If no cue matches, omit video (doc evidence still shows).

### GET /api/terminal/graph?id=<elementId>&hops=1
Return the ego-network subgraph for the power-map ({nodes,links} in the same shape as /api/graph), centered on the entity, capped ~120 nodes, higher-degree neighbors first. (Can delegate to the existing expand logic.)

Guard everything: if Neo4j/DB unavailable, return {error} with 200 and empty arrays; never crash the server.

## Client (/terminal page, new src/TerminalPage.tsx; client-route on window.location.pathname like /graph)
- Search box (debounced) -> results list; selecting an item loads entity + graph.
- Power-map center panel (react-force-graph-2d), dark theme, color by label, click-to-recenter (fetch that node's entity+graph).
- Dossier panel: header, stat tiles (e.g. "Win rate 4/4 · board avg 81%", "7 linked cases", vote tallies), the LLM brief, and a connections list (clickable -> recenter).
- Evidence dock: doc snippet cards + an embedded YouTube iframe at the timestamp when a video receipt exists (lazy-load iframe only when a receipt is present). Each evidence card links out to the source.
- Prediction widget on Case dossiers: shows the forecast + cited precedents.
- Strict TS must compile (npm run build). Reuse styles.css but add a scoped dark terminal theme.

## Acceptance
1. npm run build passes.
2. /api/terminal/search?q=story returns Story Cottage / RZ-26-1 etc.
3. /api/terminal/entity?id=<a Case like RZ-26-1> returns status + vote tally + applicant + prediction + >=1 evidence item (doc), and a video receipt if a transcript cue mentions it.
4. /api/terminal/entity?id=<an attorney e.g. Grace Wiley> returns win-rate analytics ("N of M decided approved" + board base_rate) and their cases.
5. /terminal renders search -> power-map + dossier + evidence, and clicking a connection recenters. Spot-check that a displayed stat matches a direct Cypher count (no fabrication).

Do NOT git commit. Secrets stay in .env. Build the entity dossier + evidence dock (incl. video receipts) most solidly — that is the wow. LLM only phrases Cypher-computed facts.
