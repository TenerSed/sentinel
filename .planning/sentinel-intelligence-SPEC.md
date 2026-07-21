# Sentinel Intelligence Engine — SPEC

The hero feature. NOT a search box over public records (googleable). Instead: surface patterns across 2,600+ documents / 467 cases / 100 videos that no human has time to assemble, then let GPT-5.6 narrate/predict/draft. The graph is the moat; the LLM is the storyteller.

## Design principle (responsible AI + no hallucination)
- **Facts come from Cypher, not the LLM.** All numbers, counts, rates, names, outcomes are computed by deterministic Cypher queries over Neo4j. The LLM receives those facts as structured JSON and may ONLY: phrase them as a headline, reason about a prediction over the provided precedents, or draft a public comment. It must cite the underlying case_numbers/documents and must never introduce a number or name not in the provided facts.
- Every finding links to evidence: case_number(s), source Document(s), and (when available) a YouTube timestamp deep-link.
- LLM provider is abstracted (reuse scripts/graph/lib/llm.mjs pattern). Default LLM_PROVIDER for the product is set by env; it works today on openrouter/deepseek, and MUST be switched to OpenAI GPT-5.6 (OPENAI_API_KEY, model gpt-5.6) for the compliant hackathon submission. Do not hardcode a provider.

## Three capabilities

### 1. Connect-the-dots "Findings feed" (the hero)
Auto-generated investigative findings, each = a Cypher-computed fact + an LLM-written one-line exposé + evidence links. Compute these finding types:

- **Repeat applicants / developers**: entities with APPLICANT_FOR to >=2 Cases.
  `MATCH (o)-[:APPLICANT_FOR]->(c:Case) WHERE (o:Organization OR o:Person) AND o.name IS NOT NULL WITH o, collect(DISTINCT c) AS cs WHERE size(cs)>=2 RETURN o.name AS name, labels(o)[0] AS kind, size(cs) AS cases, [x IN cs | x.case_number] AS case_numbers ORDER BY cases DESC LIMIT 25`
- **Attorney influence + approval rate**: attorneys via REPRESENTS→APPLICANT_FOR→Case, with approval rate from normalized Case.status.
  `MATCH (a:Person)-[:REPRESENTS]->(x)-[:APPLICANT_FOR]->(c:Case) WHERE a.name IS NOT NULL WITH a, collect(DISTINCT c) AS cs RETURN a.name AS attorney, size(cs) AS total, size([x IN cs WHERE toLower(coalesce(x.status,'')) CONTAINS 'approv']) AS approved, [x IN cs | x.case_number] AS case_numbers ORDER BY total DESC LIMIT 25`
- **Approved-despite-opposition (the gotcha)**: Cases whose status is approved AND that have associated opposition Sentiment. FIRST probe the reliable join (try, in order: Case and OpenEntity:Sentiment sharing source_id; Case-[:EVIDENCED_BY]->(:Document)<-[:MENTIONED_IN]-(:Sentiment); Sentiment whose name/props reference the case_number). Use whichever returns rows; document the chosen join in a comment. Return case_number, approval status, and the opposing sentiment text(s).
- **Approval-rate outliers**: applicants/attorneys with approval rate notably above/below the overall base rate (compute the base rate = approved Cases / Cases-with-terminal-status).

Normalization helpers (do in Cypher or JS): status → APPROVED if toLower contains 'approv'; DENIED if contains 'den'/'reject'; WITHDRAWN if contains 'withdraw'; PENDING otherwise. Dedupe near-duplicate person/org names (case-insensitive, trim, collapse whitespace; optionally Levenshtein<=2 for obvious variants like 'Hilleary'/'Hillary') before aggregating — at minimum lower+trim.

Server: GET /api/insights/findings → runs the above, then for the top N findings calls the LLM once (batched) to produce a punchy headline + 1-sentence "why it matters" per finding (LLM gets the JSON facts, returns {findingId, headline, why} array — no new facts). Returns [{type, headline, why, stat, case_numbers, entities, evidence:[{case_number, doc_id?, url?}]}].

### 2. Precedent prediction ("will it pass?")
Given a case_number OR a hypothetical {case_type, applicant?, has_staff_recommendation?, opposition_count?}:
- Cypher: find comparable Cases (same case_type; optionally same applicant/attorney) with terminal status; compute base approval rate + counts.
- LLM: given the retrieved precedent set (case_numbers + statuses + factors) as facts, produce a forecast: likelihood band (e.g. "Likely approve ~78%"), the 2-3 factors driving it, and the cited precedents. Must only reason over provided precedents; cite case_numbers.
- Server: GET /api/insights/predict?case=<num>  or  POST with the hypothetical.

### 3. Personal briefing + drafted comment ("what's near me")
Given an address (or a parcel_no):
- Resolve to a Parcel (we have 39k parcels with geometry + address). Find relevant Cases: nearest/related by shared street/subdivision/zoning, or Cases whose CONCERNS Parcel is spatially near (if geometry available) — for v1, match by address token / subdivision / same zoning district is acceptable; document the heuristic.
- LLM: write a plain-language briefing ("here's what's happening near you and why it matters") over the retrieved cases (facts only), PLUS draft a public comment the resident could submit for an upcoming/related case. Cite case_numbers + link to the meeting video timestamp where discussed.
- Server: GET /api/insights/near?address=... (or ?parcel=...).

## UI — /investigate page (and link from /graph and the main app)
- **Findings feed** front and center: a scrollable list of auto-surfaced exposés (headline + why + stat + evidence chips that open the source doc/video). This is the "holy shit" screen.
- **Predict** panel: pick a case or fill the hypothetical → forecast with cited precedents.
- **Near me** panel: address input → briefing + drafted comment (copyable).
- Reuse the existing app style (styles.css) and the /api/graph/expand evidence pattern for citations. Clicking any evidence chip should deep-link (document title, or youtube watch?v=..&t=..s).
- Keep it demo-tight: the Findings feed must look great with real data on first load.

## Acceptance
1. GET /api/insights/findings returns >=8 findings with real stats (repeat applicants incl. names like Grace Wiley/Story Cottage, attorney approval rates) and LLM headlines; every finding has >=1 evidence link. No fabricated numbers (spot-check a stat against a direct Cypher count).
2. GET /api/insights/predict?case=<a real case> returns a forecast citing >=2 precedent case_numbers.
3. GET /api/insights/near?address=<a Fishers address in parcels> returns a briefing referencing >=1 real case + a drafted comment.
4. /investigate renders all three; npm run build (tsc + vite) passes.
5. All LLM calls go through the provider abstraction; the facts in every response trace to Cypher (the LLM adds only language). Document in a short README section.

Do NOT git commit. Secrets stay in .env. Build the Findings feed first and most solidly (it is the hero); predict + near-me second.
