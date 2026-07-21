# Sentinel — Resident Ally (product reframe SPEC)

Reposition the product from a pro "terminal" to a resident-facing civic ally: **"the intelligence developers pay lobbyists for — free, for the residents they're building next to."** Target user: Maya, a non-political homeowner who just learned something is being built near her and feels powerless against a 200-page PDF posted 3 days before a 7pm meeting. This is a WRAP, not a rebuild: reuse the graph, dossier analytics, prediction, and evidence (video + doc) engine already built in server/insights.mjs + server/terminal.mjs + Neo4j. Keep /terminal (deep dive), /graph, and the existing feed available; add the resident experience as the new front door.

## Core principle: the moat is the data, and TRUST
Everything shown must be (a) grounded in the actual public record with a receipt (document snippet or YouTube timestamp), and (b) computed from the graph, never invented by the LLM. Put this front and center as the product's promise: a persistent "VERIFIED FROM PUBLIC RECORD · NEVER GUESSED" trust marker, and a short "Why not just ask ChatGPT?" explainer (a chatbot never read these records, can't cross-reference them, and will hallucinate a vote). The LLM (GPT-5.6 via the existing provider abstraction; OpenRouter/deepseek now, OPENAI gpt-5.6 for the final submission) ONLY turns Cypher-computed facts into plain language, drafted comments, and impact explanations — and must cite case_numbers / documents.

## Design language
Warm, trustworthy, editorial (investigative-journalism feel) — NOT cold Bloomberg black. Light or warm-neutral base with a serious accent, big readable type, generous spacing. MOBILE-FIRST (residents are on phones): single-column, thumb-friendly, cards. Receipts (video embeds, doc quotes) are prominent, not hidden. Emotional but factual headlines.

## Routing
- `/` → new resident home (SentinelHome). Move the existing app feed to `/feed` (add a link). Keep `/terminal`, `/graph`, `/investigate` as secondary/"deep dive" links.
- Client-routing via window.location.pathname (same pattern as GraphPage/TerminalPage).

## Screens & features

### 1. Home / "Watch your street" (hero)
- One promise headline + subhead ("See what your local government is doing to your neighborhood — before it's decided.").
- Address input: "Enter your address" with a prominent **"Try a live example"** button that loads a real, decided, emotionally strong case (the Story Cottage memory-care rezoning). The example MUST reliably work in the demo.
- The trust marker + one-line "why not ChatGPT" link.

### 2. Near-Me feed (results for an address)
- Server: GET /api/near/feed?address=... (build on the existing insights.near/parcel-matching; if address doesn't match a parcel, fall back to a curated set of recent high-impact cases so the demo never dead-ends). Return ranked items: { case_number, title, plain_headline, status ('APPROVED'|'DENIED'|'UPCOMING'|'PENDING'|'TABLED'), impact_line, distance_hint }.
- UI: a stack of cards. Each card: a status badge (🚨 approved / 🔴 denied / ⏳ upcoming), a plain-language headline (GPT-5.6 from facts), and a one-line "why it matters to you." Tap → case detail.

### 3. Case detail — "Should you worry?" (the emotional core)
Server: GET /api/near/case?case=<num> composing existing engine pieces into resident-framed sections:
- **What it is** — 1-2 plain sentences (LLM from facts: request, rezone_from→to, parcel/address).
- **Who's behind it** — applicant + attorney, each with track record framed as asymmetry: "This developer appears in N cases (incl. under related names); their attorney is X-of-Y approved before this board." (from the dossier analytics; dedupe near-duplicate names before counting).
- **Did they listen?** — opposition sentiment vs outcome + the vote tally, with the **video receipt** (embed the YouTube clip at the timestamp where it was discussed/voted; reuse terminal.mjs video-cue resolution). E.g. "3 residents opposed. Approved 5-0. Watch the vote →".
- **The odds** — prediction from precedent (reuse insights.predict) as a plain "Likely approved (~82%), based on N comparable decisions" with cited precedents.
- **Your move** — GPT-5.6 drafts an editable public comment the resident could submit (grounded in this case's facts, first-person, respectful, ~120 words), PLUS the meeting context (board, date if known) and a "what to say" bullet list. Provide a Copy button.
- **Receipts** — document snippets + the video embed, each linking to the public source.
Graceful fallbacks everywhere (no video → doc receipt; LLM fail → templated text; missing data → hide that section).

### 4. Shareable exposé card
- A clean, screenshot-optimized summary card (headline + the gut-punch stat + "verified from public record" + a short URL/route). A "Share" / "Copy" affordance. This is the virality surface — make it look great as an image.

### 5. Trust / "Why not ChatGPT" explainer
- A short, punchy section or modal: 3-4 bullets contrasting a chatbot (never read these records, can't cross-reference, hallucinates votes, no receipts) with Sentinel (read all N documents + M videos, cites every claim, computes from real decisions). Keep it factual and confident.

## Acceptance
1. `npm run build` passes (strict TS + vite).
2. `/` renders the resident home; "Try a live example" loads the Story Cottage memory-care case detail with: what-it-is, who's-behind-it (with a track-record stat), did-they-listen (with a real video embed at a timestamp), the odds (prediction), and a drafted public comment (Copy works).
3. GET /api/near/feed?address=<a real Fishers address in parcels> returns ranked items; an unmatched address returns the curated fallback (never empty).
4. GET /api/near/case?case=<a decided case> returns all sections with >=1 receipt and a drafted comment; every stat traces to a Cypher count (spot-check one).
5. The trust marker + "why not ChatGPT" content is present. Existing /feed, /terminal, /graph still load.
6. Mobile layout: at 390px width the home + a case detail are single-column and usable (verify via build/CSS; no need to screenshot).

Do NOT git commit. Secrets stay in .env. Build the home → feed → "Should you worry?" case detail (with the drafted comment + video receipt) most solidly — that is the demo. LLM only phrases Cypher facts; every claim cites a source.
