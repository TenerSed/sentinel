# Phase 1: Evidence Foundation - Pattern Map

**Mapped:** 2026-07-18  
**Files analyzed:** 6 existing application/config files  
**Analogs found:** 5 / 10 anticipated files

## Scope note

The repository currently contains a small Vite/React static dashboard. It has no database, Node script, server boundary, test, source registry, or seed-validation analog. D-15 keeps Vite as the Phase 1 UI baseline; the stale Next.js recommendations in older project research are not an implementation pattern for this phase.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match quality |
|---|---|---|---|---|
| `package.json` | config | process execution | `package.json` | exact |
| `scripts/seed.ts` | script | batch / file-I/O | none | missing |
| `scripts/validate-seed.ts` | script | batch / transform | none | missing |
| `data/lamplighter.db` | generated data | batch output | none | missing |
| `src/demo-seed.ts` (or equivalent generated browser-safe read model) | model | static import / transform | `src/data.ts` | partial |
| `src/types.ts` | model | static type contract | `src/types.ts` | exact |
| `src/App.tsx` | component/controller | event-driven selection | `src/App.tsx` | exact |
| `src/styles.css` | styling | presentational | `src/styles.css` | exact |
| `src/main.tsx` | bootstrap | client render | `src/main.tsx` | exact |
| minimal validation check | test/script | batch | none | missing |

## Pattern Assignments

### `package.json` (config, process execution)

**Analog:** `package.json` lines 1–22

The project uses direct npm scripts; retain this shape and add `demo` as the judge entry point rather than introducing a task runner.

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview"
}
```

**Phase implication:** `npm run demo` should be a deterministic local command. It must validate/read only committed seed artifacts and must not call a network or require an API key.

---

### `src/demo-seed.ts` (model, static import / transform)

**Closest analog:** `src/data.ts` lines 1–80

The current browser data seam is a typed module importing a type and exporting a constant array.

```ts
import type { Signal } from "./types";

export const signals: Signal[] = [
  { id: "...", title: "...", citations: [{ label: "...", page: "...", excerpt: "...", url: "..." }] },
];
```

**Phase adaptation:** replace this placeholder-only module with a browser-safe, generated/read-only representation of already validated evidence. Do not make the client import SQLite bindings, raw secrets, live-fetch code, or the old `Signal` objects. Keep the static-import seam, but model only fields permitted by the evidence contract.

---

### `src/types.ts` (model, static type contract)

**Analog:** `src/types.ts` lines 1–22

Types are declared as small exported aliases with no runtime work.

```ts
export type Citation = {
  label: string;
  page: string;
  excerpt: string;
  url: string;
};
```

**Phase adaptation:** define the evidence inspector’s canonical read-model types here (or replace this file) with explicit source type, location, canonical URL, exact quote, and either page or timestamp locator. Keep runtime validation outside this type-only module: TypeScript alone cannot prove a bundled seed is valid.

---

### `src/App.tsx` (component/controller, event-driven selection)

**Analog:** `src/App.tsx` lines 11–38 and 76–90

The existing app already has the key inspector interaction: a selected ID in local state, a derived selected record, and full-width semantic buttons in a list which update a detail panel.

```tsx
const [selectedId, setSelectedId] = useState(signals[0].id);
const selected = signals.find((signal) => signal.id === selectedId) ?? signals[0];

<button className={`signal-card ${selected ? "selected" : ""}`} onClick={onSelect}>
  ...
</button>
```

**Phase adaptation:** reuse only this selection flow and the list/detail layout. Remove the sidebar, filters, priority/stage/relevance controls, report actions, metrics, and all placeholder civic facts (lines 42–74 and 78–89). Add explicit loading, invalid-seed, and empty branches before dereferencing the first record, because the current `signals[0].id` pattern is unsafe for an empty or invalid seed.

---

### `src/styles.css` (styling, presentational)

**Analog:** `src/styles.css` lines 1–8, 25–29, 45–50, 55–60, 70–84, 85–86

Useful established visual primitives are the existing global reset, typography, two-column grid, card/detail surfaces, selected-row styling, and responsive stack.

```css
.radar-grid { display: grid; grid-template-columns: minmax(480px, 1.45fr) minmax(310px, .75fr); align-items: start; gap: 22px; }
.signal-list-panel, .detail-panel { background: #fbfbf8; border: 1px solid #e2e3dc; border-radius: 10px; }
.detail-panel { padding: 23px 24px; position: sticky; top: 24px; }
@media (max-width: 1060px) { .radar-grid { grid-template-columns: 1fr; } .detail-panel { position: static; } }
```

**Phase adaptation:** retain the approved manual-CSS palette, fonts, responsive thresholds, and card/detail primitives. Rename selector classes to evidence-oriented names while deleting Sentinel sidebar, brief, metric, filtering, priority, tag, and “why this matters” styles. Add visible focus styling and the specified 44px narrow-screen targets; the current button rules do not provide a focus indicator.

---

### `src/main.tsx` (bootstrap, client render)

**Analog:** `src/main.tsx` lines 1–10

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

**Phase implication:** keep this bootstrap unchanged unless a small, local validation-state provider is genuinely required. The evidence inspector belongs in `App`; no routing/state package is justified.

---

### `scripts/seed.ts`, `scripts/validate-seed.ts`, `data/lamplighter.db`, and validation check

**Analog:** none.

There is no Node-side code or test convention in the repository. Keep the first implementation deliberately direct:

- one seed writer that creates the committed SQLite artifact from hand-verified fixtures;
- one validator callable by `demo`/CI that fails non-zero for missing required provenance, invalid quote length, absent locator where required, or broken foreign-key/source-location relations;
- a browser-safe generated read model if Vite must render the evidence without a server process.

Do not introduce a service layer, ORM, API route, test framework, or client-side SQLite merely to mimic the stale Next.js architecture. Add those only when a future phase needs an actual server boundary.

## Shared Patterns

### Imports and module style

**Sources:** `src/App.tsx` lines 1–3; `src/data.ts` line 1

- Relative imports only; no path aliases or barrel files.
- Use `import type` for type-only dependencies.
- Double quotes and semicolons are the observed source style.

### UI state and error boundary

**Source:** `src/App.tsx` lines 29–38

Existing state is local React `useState` plus `useMemo`; no shared store exists. Preserve local state for selection. The existing app lacks loading/error validation and blindly reads the first record; Phase 1 must add the required explicit states rather than copy that unsafe fallback.

### External evidence links

**Source:** `src/App.tsx` line 88

```tsx
<a href={citation.url} target="_blank" rel="noreferrer" className="citation">
```

Continue to use a normal anchor for canonical public-record links, retaining `target="_blank"` and `rel="noreferrer"`. The displayed label/locator must come from validated seed fields, never a constructed arbitrary URL.

### Missing patterns / guardrails

- No current code establishes SQLite access, migrations, database transactions, source registry lookup, locator validation, raw-content hashing, server-only modules, or automated tests.
- No current code establishes accessibility focus styling or asynchronous loading/error handling.
- `src/data.ts` is explicitly placeholder data under D-14 and must not be treated as a fixture or source of verified content.
- The UI runs in a browser; any SQLite implementation or optional providers must remain outside the Vite client bundle. Phase 1’s no-key demo should consume a generated, validated read model rather than attempting browser database access.

## Planning Constraints Derived from the Map

1. Build the evidence validation/seed generation boundary before adapting `App`; the UI must receive only eligible records.
2. Keep database/provenance logic in Node scripts for this Vite phase, and make the client consume a committed static derivative.
3. Reuse the selection/list/detail interaction and responsive CSS; delete unrelated dashboard chrome instead of adapting it.
4. Add a small runnable validation command because no test pattern exists and the evidence contract is a trust boundary.

