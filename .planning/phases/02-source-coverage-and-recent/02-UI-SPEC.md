---
phase: 2
slug: source-coverage-and-recent
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-18
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for Lamplighter's location-aware Recent feed. It extends the Phase 1 evidence inspector; Curated ranking and grounded Chat remain unavailable in this phase.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — retain the merged Vite/React custom CSS |
| Preset | not applicable |
| Component library | none |
| Icon library | none; use clear text labels and existing Unicode arrow only for external links |
| Font | existing `DM Sans` body, `DM Mono` metadata, and `Playfair Display` headings |

Do not initialize shadcn or add a component, icon, or toast library. Reuse the Phase 1 card, selected-row, evidence-panel, focus-outline, and responsive stacked-panel patterns. The native `<select>` is the location control; it keeps the demo accessible and dependency-free.

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Status dots, inline metadata gaps |
| sm | 8px | Metadata, label, and control-content gaps |
| md | 16px | Row internals and compact control spacing |
| lg | 24px | Feed panel and evidence-panel padding |
| xl | 32px | Desktop column gaps and page sections |
| 2xl | 48px | Desktop page padding |
| 3xl | 64px | Not used in this compact feed |

Exceptions: controls and bottom-nav targets are at least 44px tall on narrow screens; the fixed bottom bar reserves enough bottom page padding that the last feed row remains fully visible.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 16px | 400 | 1.5 |
| Label | 14px | 600 | 1.35 |
| Heading | 20px | 600 | 1.2 |
| Display | 32px | 600 | 1.2 |

Use only 400 and 600. `DM Mono` at 14px identifies jurisdiction, source type, dates, locators, and offline status. Use `Playfair Display` for the page title, feed section title, and selected-record title only.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f5f5f0` | Page background and quote surface |
| Secondary (30%) | `#fbfbf8` | Feed rows, evidence panel, location control, and bottom navigation |
| Accent (10%) | `#667f20` | Selected row border, active Recent tab, verified/offline status dot, and primary source link |
| Destructive | `#b23a2b` | Seed and import failure states only; no destructive action exists |

Accent reserved for: selected Recent row, active `Recent` tab, verified/offline status, and `Open public record`. It must not imply a record is current, adopted, legally effective, important, or true.

---

## Component Inventory and Interaction Contract

### 1. Recent shell and compact coverage control

- Header copy: eyebrow `LAMPLIGHTER / OFFLINE DEMO`; display heading `Recent government updates`; body `Source-grounded public records for the coverage you selected.`
- The compact native location control sits directly below the heading. Its accessible label is `Coverage`; choices are `Indianapolis`, `Indiana`, and `U.S. federal` from the validated seed registry.
- Selection takes effect immediately without a network request. The selected value remains visible in the control and determines the feed heading and empty state.
- `Indianapolis` includes records from Indianapolis, Indiana, and U.S. federal coverage. Direct `Indiana` and `U.S. federal` selections include only that exact coverage. This relationship is data-derived, not communicated as a legal status.
- Retain the Phase 1 operational strip: `Seed ready · offline · no API key required`. It must not claim completeness, live refresh, or legal status.

### 2. Recent feed

- Render one validated, eligible civic update per full-width button. No clustering, inferred topic groups, relevance scores, generated summaries, or placeholder civic facts.
- Sort source publication/update time newest-first; stable ID ordering resolves equal timestamps. The feed title is `Recent in {coverage label}` and its count uses `1 update` / `{n} updates`.
- Each row includes, in this order: jurisdiction, source-type badge, publication/update date, title, one exact quote truncated only after a complete word, and evidence locator. A row must not introduce a claim beyond those stored fields.
- Source-type labels are `Primary record` for government records and public video transcripts, and `Reporting` for reporting. A reporting row uses the same layout but has a visible `Reporting` label; it never says or implies the underlying matter occurred, passed, failed, or has a particular legal status.
- Selected state uses the existing 2px accent left border plus `aria-pressed`/selected semantics and the existing visible focus outline. Selecting a row opens or updates evidence without fetching.
- Long titles clamp to three lines in the list. Exact-quote preview clamps to two lines with an ellipsis. Details never truncate their title or quote.

### 3. Evidence panel

- On screens at least 1060px wide, show the selected item in a sticky right-side panel beside the feed. Below 1060px, render it as a normal stacked panel after the feed. Do not add a detail route or modal.
- Show only validated selected-record fields: title, jurisdiction, source type, publisher, publication/update date, exact quote (25 words maximum), and locator.
- Use the leading label `Exact source excerpt` for the bordered quote block. Citation format remains `Source title · p. N` or `Source title · M:SS`.
- A reporting item adds the plain label `Reporting, not the primary record` immediately above its quote.
- Primary external action is `Open public record`; it opens the stored canonical URL in a new tab. Do not append or generate a PDF-page fragment, video `t=`, tracking parameter, or any other URL modification.
- Keep `Copy citation` as the secondary non-destructive control. If the platform clipboard is unavailable or rejects the request, show inline status: `Couldn’t copy citation. Select the citation text instead.`

### 4. Bottom navigation

- A fixed bottom navigation is visible on all screen sizes and contains exactly three equally sized button targets: `Recent`, `Curated`, and `Chat`.
- `Recent` is active and uses accent plus an explicit active label/`aria-current="page"`; the label and state must not rely on color alone.
- `Curated` and `Chat` are visibly unavailable but remain enabled enough to announce why. Tapping either leaves the user on Recent and displays an inline, polite status directly above the bar: `Curated is coming in a later phase.` or `Chat is coming in a later phase.` Replace the message on the next unavailable-tab tap; do not use a toast library or a new route.
- The unavailable message is not an error and disappears when the user selects a feed row or changes coverage.

### 5. Failure and empty boundaries

- The browser reads the bundled, validated seed only. No UI action fetches sources, rebuilds the database, imports material, or calls a model.
- Missing, unreadable, or invalid bundled seed replaces the Recent shell with the Phase 1 loud error: `Bundled evidence could not be validated. This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.` Show the technical diagnostic in a scrollable `<pre>` for maintainers.
- A valid seed with no eligible records for the selected coverage keeps the header, coverage control, and bottom navigation visible. It shows `No verified updates for {coverage label}` and `Lamplighter will not broaden coverage or substitute other records. Choose another configured coverage to inspect its bundled public records.` Do not substitute seed-wide content.
- Initial validation uses `Validating bundled evidence…`; rows and evidence controls are unavailable until validation succeeds.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Open public record` |
| Ready status | `Seed ready · offline · no API key required` |
| Loading state | `Validating bundled evidence…` |
| Empty state heading | `No verified updates for {coverage label}` |
| Empty state body | `Lamplighter will not broaden coverage or substitute other records. Choose another configured coverage to inspect its bundled public records.` |
| Error state | `Bundled evidence could not be validated. This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.` |
| Reporting label | `Reporting, not the primary record` |
| Unavailable Curated | `Curated is coming in a later phase.` |
| Unavailable Chat | `Chat is coming in a later phase.` |
| Destructive confirmation | None — Phase 2 exposes no destructive action. |

---

## Accessibility and Content Rules

- Use semantic `main`, `header`, `nav`, `section`, `button`, `label`, `select`, `time`, `article`, `blockquote`, and anchor elements. Bottom navigation is a `nav` with buttons because unavailable tabs do not navigate.
- Every feed button announces title, jurisdiction, source type, date, and selected state. Tab/Shift+Tab plus Enter or Space must operate feed, selector, evidence actions, and navigation.
- Keep 4.5:1 text contrast and the existing 2px focus indicator. Do not convey primary/reporting, active/inactive, selection, or error state with color alone.
- On narrow screens, use 16px page padding; controls and bottom-nav buttons meet 44px targets. The source link is a readable label, never a bare canonical URL.
- Never render data from the retired placeholder `signals` dataset. Incomplete imports remain non-renderable drafts and cannot enter Recent.

---

## UI Considerations

Applicable state considerations resolved: 8 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| loading | Recent shell and feed | ✅ covered | Initial validation renders the documented loading copy; feed selection and evidence actions are unavailable until the seed validates. |
| error | Recent shell | ✅ covered | Missing, unreadable, or invalid seed renders the documented no-network error plus diagnostic. |
| empty | location-scoped Recent feed | ✅ covered | Valid but ineligible selected coverage renders the documented selected-jurisdiction empty state with no fallback records. |
| populated | Recent feed and evidence panel | ✅ covered | Eligible records render newest-first; a selected record exposes only validated provenance in the responsive panel. |
| partial | reporting and incomplete imported records | ✅ covered | Reporting is explicitly labeled; incomplete imports remain drafts and never render. |
| zero-one-many | Recent feed | ✅ covered | Feed count uses singular/plural copy; one record uses the same row and evidence-panel pattern. |
| overflow | feed, quote preview, detail panel, and bottom navigation | ✅ covered | Feed scrolls normally; rows clamp title/preview; detail wraps; bottom padding prevents bar overlap. |
| long-text | titles, quotes, locators, diagnostics, and source links | ✅ covered | Row text clamps at specified limits; detail wraps without clipping; diagnostics scroll; links use readable labels. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable — manual CSS and native controls only |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
