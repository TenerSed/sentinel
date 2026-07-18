# Lamplighter Feature Research

**Scope:** a reliable, judge-runnable civic-intelligence demo by **Tuesday, July 21, 2026, 5:00 PM PT**. Initial registry is Indianapolis/Marion County, Indiana, and U.S. federal sources. This is a civic-information product, not a campaigning or voter-persuasion product.

## Product expectation

Residents need a short path from “what changed where I live?” to the underlying public record. The smallest credible loop is: choose a configured place, read recent verified changes, see a locally tailored ordering, ask a constrained question, and open the exact supporting record. Official data can support this: the Indianapolis calendar exposes council and committee meetings; Indiana’s General Assembly publishes bill/session records; Congress.gov provides public legislative/member/vote data via API. Congress.gov itself offers bill and member activity alerts, which validates freshness and following activity as familiar expectations, but alerts are not needed for this demo.

## Feature classification

| Feature | Class | MVP behavior | Complexity | Dependencies | Roadmap implication | Confidence |
|---|---|---|---|---|---|---|
| Configured locale selector | Table stakes | Select Indianapolis, Indiana, or Federal; show coverage and never imply nationwide coverage. | Low | Source registry with jurisdiction labels | Build first; adding a locale is registry data, not UI code. | High |
| Recent civic feed | Table stakes | Date-ordered legislation, office-holder, policy, and meeting updates; every card has source, date, jurisdiction, and link. | Medium | Seeded SQLite records; normalizer | Primary demo screen. Keep a small hand-verified seed set. | High |
| Direct evidence citations | Table stakes / trust gate | Card and answer links resolve to stored source URL; show page number for documents and timestamp for video when available. | Medium | Citation schema; source artifacts/metadata | Non-negotiable acceptance gate; do not ship a claim whose locator is missing. | High |
| Source detail / evidence opening | Table stakes | Open original record at citation; use URL fragment/timestamp where supported, otherwise show the saved locator beside the source link. | Low-Medium | Citation locators; source URLs | Covers the “show me why” moment in the recording. | High |
| Curated feed | Differentiator | Re-rank only already-eligible, cited items from the selected locale using recent reads and questions; explain the lightweight reason (“Because you read transit updates”). | Medium | Event history or session state; deterministic eligibility filter; relevance score | Build after Recent. Seeded/demo history makes it reliable without accounts. | Medium-High |
| Grounded chat | Differentiator | Retrieve only surfaced/stored source chunks for the selected locale; answer with citations or say the evidence does not support an answer. | High | Chunked source text; retrieval; strict server-side model call; citation validator | Demo centerpiece, but one reliable question path beats broad coverage. | High |
| Video-transcript evidence | Differentiator | Treat a timestamped meeting/town-hall/vote transcript as a first-class source and link to timestamp. | Medium | Public video/transcript availability; timestamp schema | Include a few verified examples, not universal transcription. | Medium |
| Source registry / provenance display | Differentiator | Show configured agencies/publications, source type, jurisdiction, and refresh/seed status. | Low-Medium | Versioned registry data | Makes narrow coverage honest and expansion configuration-driven. | High |
| Live ingestion refresh | Supporting capability | Fetch and normalize a deliberately small set of RSS/API sources; preserve raw URL/date and extraction status. | Medium | RSS/news provider; Congress API key if used | Implement only after seeded path works; never make judging depend on it. | Medium |
| Accessibility basics | Table stakes | Keyboard-accessible navigation, discernible link text, readable source/date labels, and status/error states. | Low | Semantic HTML/Tailwind | Include during screen implementation, not as a separate feature. | High |

## Explicit product guardrails

### Privacy

- No accounts, email, address, voter file, contacts, precise location, or cross-device behavioral profile in the first release. Locale selection may be manual; do not request device location.
- Keep personalization local to the browser/session where possible. If reading/question events reach SQLite, store the minimum opaque/session-scoped data needed for ordering, provide a clear reset, and set a short retention rule. Do not use it to infer ideology, party affiliation, or sensitive traits.
- Send only the retrieved public-source excerpts and the user’s current question to the model. Do not send secrets, raw provider credentials, hidden internal prompts, or unnecessary history.
- Secrets and provider/model calls stay server-side. This is already a project constraint and is also consistent with FTC data-minimization guidance: collect/access only data needed for the feature and dispose of unneeded data.

### Political information

- Surface factual, attributable records about legislation, policy, office holders, public votes, and clearly attributed public candidate statements only when the source is in the registry and cited.
- Do not generate campaign material, persuasion, targeted political messaging, lobbying calls to action, voter targeting, or recommendations for/against candidates, parties, or ballot measures. OpenAI’s policy prohibits political campaigning, lobbying, election interference, and demobilization.
- Do not turn reading or question history into political profiling. A curated view may use explicit topical interaction to rank existing records, but must not label a resident’s political beliefs or predict vote choice.
- Preserve uncertainty and disagreement: distinguish a bill from enacted law; label source type; attribute a position; state when sources conflict or evidence is absent. Prefer abstention to an unsupported synthesis.

### Citation and provenance

- Every factual Chat sentence and every surfaced political claim must map to at least one stored citation; no citation means no claim. A response may contain “I can’t verify that from Lamplighter’s sources.”
- A citation record needs: stable ID, source registry ID, original URL, title/publisher, jurisdiction, source type, publication/event date, retrieved date, excerpt/chunk ID, and locator (`page`, `timestampSeconds`, or section). Store raw/source text or an immutable enough snapshot/hash to reproduce retrieval.
- Cite at the claim level, not only in a generic footer. The UI must expose citations as operable links; for video use a timestamped link, for documents show the page locator even if deep linking is unavailable.
- Keep deterministic controls outside the model: selected-locale filter, allowlisted sources, retrieval set, citation validation, and refusal when unsupported. The model can extract/summarize/rank only within that boundary.
- Label cited news as reporting, not primary evidence. Prefer official records for legal status, votes, office holder identity, and meeting actions; use news for context only when clearly attributed.

## Anti-features for this release

| Do not build | Why | Revisit when |
|---|---|---|
| Nationwide or arbitrary-location coverage | It conflicts with the verified three-jurisdiction registry and makes coverage claims unreliable. | Registry tooling and source QA support more jurisdictions. |
| Accounts, sync, email digests, push alerts, or cron/webhook infrastructure | Project explicitly excludes them; seeded SQLite is the reliable judge path. | Core feed retention/value has been validated. |
| Open-web chat, uncited answers, or model-only political summaries | Breaks provenance and can amplify hallucinations or political misinformation. | Never without an equivalent verified evidence boundary. |
| Candidate scorecards, endorsements, “who should I vote for,” persuasion, or targeting | Outside civic-information purpose and incompatible with political-campaigning restrictions. | Do not add as an AI feature. |
| Precise geolocation, address/parcel history, voter-data enrichment, or inferred ideology | Disproportionate privacy risk; parcel graph is explicitly out of scope. | Only with a separately justified, privacy-reviewed product. |
| Fully automated transcription/scraping of every meeting | Deadline risk and unreliable citations. | Proven ingestion QA and a concrete source need. |
| A general CMS, workflow engine, or multi-tenant source administration | No user needs it to evaluate the demo. | External operators need it. |

## Recommended delivery order

1. **Registry + seeded SQLite + provenance schema:** encode the three jurisdictions and a small set of hand-checked official records, cited news, documents, and one timestamped video example.
2. **Recent + evidence opening:** prove location-to-update-to-record navigation without a model dependency.
3. **Constrained Chat:** retrieval over only those stored chunks, server-side model call, citation/locale validator, and abstention state.
4. **Curated ordering:** rank the same eligible set from minimal, resettable interaction history; show a reason and avoid political inference.
5. **Live ingestion:** add one small refresh path only if it cannot disrupt the seeded path.

This ordering deliberately skips alerting, accounts, broad ingestion, and universal transcript processing: none improves the judge’s ability to verify the core trust loop before the deadline.

## Source landscape and implementation notes

| Jurisdiction/source | Suitable records | Use in MVP | Caveat |
|---|---|---|---|
| Indianapolis/Marion County calendar and council materials | Council/committee meetings, agendas, recordings, local policy actions | Seed recent committee/full-council items and a recording with a verified timestamp. | Calendar proves meeting availability; verify each agenda/video URL and locator before seeding. |
| Indiana General Assembly | Bills, status, subject, legislator/session records | Seed a handful of current/recent bills with status and original IGA link. | A bill page/status is not evidence of enactment; model/UI must preserve the distinction. |
| Congress.gov API / official House vote data | Bills, actions, members, committees, reports, federal votes | Use API or bundled records for federal updates and vote evidence. | Congress.gov API requires an API key for live use; the bundled database remains the judge path. House roll-call XML is another official vote source. |
| Allowlisted local/state/federal news | Context, attributed reporting | Use sparingly alongside primary record, never as unlabelled fact. | Publisher terms/licensing and link rot require source-specific review. |

## Sources

- [Congress.gov API documentation](https://api.congress.gov/) — official API exposes bills, actions, members, committees, reports, meetings, and vote endpoints.
- [Congress.gov: using data offsite](https://www.congress.gov/help/using-data-offsite) and [Quick Start Guide](https://www.congress.gov/help/quick-start) — public machine-readable reuse; user-facing alerts illustrate expected “fresh activity” behavior without making alerts MVP scope.
- [Indianapolis/Marion County calendar: Full Council and committees](https://calendar.indy.gov/location/06f77ee5-a704-4b7e-82e6-d550ed7e354c/) and [Indy Parks board/committee materials](https://parks.indy.gov/about-us/park-board-and-committees/) — official meeting/calendar/agenda/recording landscape for the local registry.
- [Indiana General Assembly bills](https://iga.in.gov/legislative/2016/bills) and [legislation-by-subject example](https://iga.in.gov/legislative/2025/subject/si_taxes_sales_and_use_taxes_7147) — official bill/status/session records and the active/inactive-status distinction.
- [U.S. House roll-call XML](https://xml.house.gov/) — official machine-readable House votes from 1990 onward.
- [NIST Privacy Framework: Getting Started](https://www.nist.gov/privacy-framework/getting-started-0) — privacy risk management functions (Identify, Govern, Control, Communicate, Protect).
- [FTC: Protecting Personal Information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) — minimize collection, access only necessary data/functionality, and retain only as needed.
- [OpenAI political campaigning restrictions](https://help.openai.com/en/articles/20001255-political-campaigning-restrictions) — prohibits political campaigning, lobbying, election interference, and demobilization.

## Research confidence and gaps

- **High confidence:** narrow registry, citation-first records, seeded judge path, server-side model boundary, and avoiding accounts/alerts are explicit project constraints and supported by official source ecosystems.
- **Medium confidence:** automated live ingestion and universal timestamped transcripts; both depend on the stability, licensing, and metadata quality of each individual publisher/video host.
- **Validate before demo:** each seeded citation opens; all political claims have a citation; page/timestamp locators actually land on evidence; a deliberately unsupported Chat question abstains; resetting local personalization changes no other user’s view.
