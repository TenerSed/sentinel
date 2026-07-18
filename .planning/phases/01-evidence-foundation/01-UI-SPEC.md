---
phase: 1
slug: evidence-foundation
status: approved
shadcn_initialized: false
preset: none
created: 2026-07-18
reviewed_at: 2026-07-18
---

# Phase 1 — UI Design Contract

> Visual and interaction contract for the offline seed/status and evidence inspector. This is intentionally not the product feed, Curated view, Chat, or final navigation.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — manual custom CSS retained from the merged Vite/React baseline |
| Preset | not applicable |
| Component library | none |
| Icon library | none; use short text labels and existing Unicode symbols only where they add meaning |
| Font | existing `DM Sans` body, `DM Mono` metadata, and `Playfair Display` headings |

Do not initialize shadcn, add a component library, or use third-party blocks for this phase. Reuse the existing card/detail-panel pattern, but remove the current Sentinel-specific navigation, metrics, filters, report controls, and placeholder signal data.

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline locator and status gaps |
| sm | 8px | Compact metadata and button-content gaps |
| md | 16px | Default card internals and control spacing |
| lg | 24px | Panel padding and section separation |
| xl | 32px | Desktop inspector column gap and page sections |
| 2xl | 48px | Desktop page padding |
| 3xl | 64px | Not used in the compact inspector |

Exceptions: interactive buttons and links have a minimum 44px touch target on narrow screens; this may include transparent hit-area padding.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 16px | 400 | 1.5 |
| Label | 14px | 600 | 1.35 |
| Heading | 20px | 600 | 1.2 |
| Display | 32px | 600 | 1.2 |

Use only weights 400 and 600. `DM Mono` at 14px may identify source type, data mode, jurisdiction, citation locator, and retrieval status; it is metadata, never a substitute for readable body text. Use `Playfair Display` only for the page title and the selected record title.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f5f5f0` | Page background and inspector surface |
| Secondary (30%) | `#fbfbf8` | Cards, selected-record panel, and status strip |
| Accent (10%) | `#667f20` | Verified seed indicator, selected record border, and direct source-record links |
| Destructive | `#b23a2b` | Invalid/missing-seed status only; no destructive action exists in Phase 1 |

Accent reserved for: the `Verified seed` status dot, selected evidence record, and the `Open public record` link. Do not use accent to imply a claim is important, current, adopted, or true.

---

## Component Inventory and Interaction Contract

### 1. Inspector shell

- One centered content column with a slim top status strip, a page heading, and a two-column inspector beneath it.
- The selected evidence detail panel is the primary visual focal point; the record list is supporting navigation.
- Desktop at 1060px and above: list column is at least 480px; detail column is at least 310px and remains visible beside it. The detail panel may use the existing sticky behavior.
- Below 1060px: stack list before detail and remove sticky positioning. Below 720px: use 16px page padding and preserve 44px targets.
- Header copy: eyebrow `LAMPLIGHTER / OFFLINE DEMO`; display heading `Evidence inspector`; body copy `Verified public records bundled for Indianapolis, Indiana, and U.S. federal coverage.`
- The status strip is operational metadata only: `Seed ready · offline · no API key required`. It must not claim that records are fresh, complete, or live.

### 2. Seed status block

- Display record count, covered jurisdictions, source-kind count, and the presence of both document-page and video-timestamp locators only after local seed validation succeeds.
- Labels: `Records`, `Coverage`, `Primary records`, `Timestamp evidence`.
- Do not display invented civic updates or aggregate “signal” counts. Counts are derived from validated seed data.
- If any record is reporting rather than a primary public record, its source type visibly reads `Reporting`; it never receives the verified-primary indicator.

### 3. Evidence record list

- A single selectable list of validated records. Each row is a full-width button with: jurisdiction, source-type label (`Primary record` or `Reporting`), publication/update date, concise title, and exact evidence locator.
- Do not show relevance levels, stages, inferred summaries, search/filter controls, or generic placeholder cards in this phase.
- The selected row has a 2px left accent border plus a visible keyboard focus outline; selection must not rely on color alone.
- Selecting a row updates the detail panel without fetching the network.

### 4. Evidence detail panel

- Shows only fields resolved from the selected validated record: title, jurisdiction, source type, public publisher, date label, exact quote (25 words maximum), and locator.
- Quote is in a bordered block with the leading label `Exact source excerpt`.
- Citation format is `Source title · p. N` for a document page or `Source title · M:SS` for a transcript/video. If a source has no applicable locator type, omit the locator rather than fabricate one.
- Primary action: `Open public record`. It is an external link to the stored canonical URL, with a page fragment or video timestamp when stored and supported.
- Secondary, non-destructive control: `Copy citation` uses the platform clipboard when available; on failure, show inline text `Couldn’t copy citation. Select the citation text instead.` No toast framework is needed.
- Reporting detail includes the plain label `Reporting, not the primary record` directly above its quote.

### 5. Failure boundary

- The browser reads only the bundled, already-validated seed representation. It must never offer a retry that fetches, rebuilds, or calls a model.
- A missing, unreadable, or invalid seed replaces the inspector with the error state below. Keep the technical reason visible in a `<pre>` or plain diagnostic line for maintainers, while the user-facing message remains concise.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Open public record` |
| Ready status | `Seed ready · offline · no API key required` |
| Loading state | `Validating bundled evidence…` |
| Empty state heading | `No verified evidence loaded` |
| Empty state body | `This demo only displays records with a stored quote, public URL, and reliable locator. Add a valid bundled seed to inspect records.` |
| Error state | `Bundled evidence could not be validated. This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.` |
| Reporting label | `Reporting, not the primary record` |
| Destructive confirmation | None — Phase 1 has no destructive actions. |

---

## Accessibility and Content Rules

- Use semantic `main`, `header`, `section`, `nav` only if it contains record navigation, `button` for record selection, `time` for dates, `blockquote` for excerpts, and an anchor for the canonical public-record link.
- Every selectable record announces title, jurisdiction, source type, and selected state. Keyboard users navigate rows with Tab/Shift+Tab and activate with Enter or Space.
- Maintain 4.5:1 text contrast, a 2px visible focus indicator, and no information conveyed by color alone.
- Long titles wrap up to three lines in list rows, then clamp with an ellipsis; the detail title and quote wrap without clipping. Canonical URLs are never rendered as unbroken visible body text.
- Never render a title, claim, status, date, source label, quote, or locator from the merged placeholder `signals` dataset. An unvalidated record is absent, not visually downgraded into a civic fact.

---

## UI Considerations

Applicable state considerations resolved: 8 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|-------------|-------------|---------------------|
| loading | seed status and evidence list | ✅ covered | Initial render shows `Validating bundled evidence…`; no records are selectable until validation completes. |
| error | seed status and evidence list | ✅ covered | Invalid, missing, or unreadable seed replaces the inspector with the documented loud error and diagnostic; no automatic network retry exists. |
| empty | evidence list | ✅ covered | A valid seed with zero eligible records shows the documented empty-state copy and no detail panel. |
| populated | evidence list and detail panel | ✅ covered | Validated records render as a selectable list; the first record is selected and its provenance appears in the detail panel. |
| partial | record metadata | ✅ covered | Records missing required quote, canonical URL, or applicable locator are excluded; optional publisher/date fields render only when stored. |
| zero-one-many | evidence list | ✅ covered | The list header uses `1 verified record` or `{n} verified records`; one record still renders the same list/detail layout. |
| overflow | evidence list and citation metadata | ✅ covered | List column scrolls vertically within the normal page; titles clamp in rows and citation metadata wraps at word boundaries. |
| long-text | titles, quotes, diagnostics, and source links | ✅ covered | Detail content wraps; row titles clamp; diagnostics use scrollable preformatted text; source links use a readable label instead of exposing raw URLs. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable — user chose manual custom CSS and no third-party blocks |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-07-18
