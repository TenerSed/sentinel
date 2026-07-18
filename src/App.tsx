import { useEffect, useMemo, useState } from "react";
import { demoSeed } from "./demo-seed";
import type { DemoSeed, EvidenceLocator, EvidenceRecord, SourceKind } from "./types";

type SeedState = { status: "loading" } | { status: "error"; diagnostic: string } | { status: "ready"; seed: DemoSeed };

const sourceLabel: Record<SourceKind, string> = {
  government_record: "Primary record",
  video_transcript: "Primary record",
  reporting: "Reporting",
};

function locatorText(locator: EvidenceLocator) {
  if (locator.kind === "page") return `p. ${locator.pageNumber}`;
  return `${Math.floor(locator.startSeconds / 60)}:${String(locator.startSeconds % 60).padStart(2, "0")}`;
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function validateSeed(seed: unknown): DemoSeed {
  if (!seed || typeof seed !== "object") throw new Error("Bundled seed is not an object.");
  const candidate = seed as Partial<DemoSeed>;
  if (candidate.version !== 1 || !Array.isArray(candidate.locations) || !Array.isArray(candidate.records)) throw new Error("Bundled seed has an unsupported shape.");
  for (const record of candidate.records) {
    if (!record || typeof record !== "object") throw new Error("Bundled seed contains an unreadable record.");
    const item = record as Partial<EvidenceRecord>;
    if (![item.id, item.locationId, item.locationLabel, item.publisher, item.sourceTitle, item.title, item.publishedAt, item.canonicalUrl, item.exactQuote].every((value) => typeof value === "string" && value.trim())) throw new Error("Bundled seed record is missing required evidence fields.");
    const url = item.canonicalUrl as string;
    const quote = item.exactQuote as string;
    if (!["government_record", "video_transcript", "reporting"].includes(item.sourceKind ?? "") || !url.startsWith("https://") || quote.trim().split(/\s+/).length > 25) throw new Error("Bundled seed record did not pass evidence validation.");
    if (!item.locator || (item.locator.kind === "page" && (!Number.isInteger(item.locator.pageNumber) || item.locator.pageNumber < 1)) || (item.locator.kind === "timestamp" && (!Number.isInteger(item.locator.startSeconds) || item.locator.startSeconds < 0))) throw new Error("Bundled seed record is missing a reliable locator.");
  }
  return candidate as DemoSeed;
}

export default function App() {
  const [state, setState] = useState<SeedState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string>();
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    try {
      const seed = validateSeed(demoSeed);
      setState({ status: "ready", seed });
      setSelectedId(seed.records[0]?.id);
    } catch (error) {
      setState({ status: "error", diagnostic: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const selected = state.status === "ready" ? state.seed.records.find((record) => record.id === selectedId) ?? state.seed.records[0] : undefined;
  const counts = useMemo(() => state.status !== "ready" ? null : {
    coverage: new Set(state.seed.records.map((record) => record.locationId)).size,
    primary: state.seed.records.filter((record) => record.sourceKind !== "reporting").length,
    timestamps: state.seed.records.filter((record) => record.locator.kind === "timestamp").length,
  }, [state]);

  if (state.status === "loading") return <main className="state-page" aria-live="polite">Validating bundled evidence…</main>;
  if (state.status === "error") return <main className="state-page error-state"><h1>Bundled evidence could not be validated.</h1><p>This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.</p><pre>{state.diagnostic}</pre></main>;
  if (!state.seed.records.length) return <main className="state-page"><h1>No verified evidence loaded</h1><p>This demo only displays records with a stored quote, public URL, and reliable locator. Add a valid bundled seed to inspect records.</p></main>;

  const citation = selected && `${selected.sourceTitle} · ${locatorText(selected.locator)}`;
  return <main className="inspector-shell">
    <header className="inspector-header">
      <p className="eyebrow">LAMPLIGHTER / OFFLINE DEMO</p>
      <h1>Evidence inspector</h1>
      <p>Verified public records bundled for Indianapolis, Indiana, and U.S. federal coverage.</p>
      <div className="seed-status"><span aria-hidden="true" />Seed ready · offline · no API key required</div>
    </header>
    <section className="seed-counts" aria-label="Bundled evidence summary">
      <div><span>Records</span><strong>{state.seed.records.length}</strong></div><div><span>Coverage</span><strong>{counts?.coverage}</strong></div><div><span>Primary records</span><strong>{counts?.primary}</strong></div><div><span>Timestamp evidence</span><strong>{counts?.timestamps}</strong></div>
    </section>
    <section className="evidence-grid" aria-label="Evidence inspector">
      <nav className="record-list" aria-label="Verified evidence records">
        <div className="panel-heading"><p className="eyebrow">BUNDLED EVIDENCE</p><h2>{state.seed.records.length} verified {state.seed.records.length === 1 ? "record" : "records"}</h2></div>
        {state.seed.records.map((record) => <button type="button" key={record.id} className={`record-row ${record.id === selected?.id ? "selected" : ""}`} aria-pressed={record.id === selected?.id} onClick={() => { setSelectedId(record.id); setCopyError(false); }}>
          <span className="record-meta">{record.locationLabel} · {sourceLabel[record.sourceKind]} · <time dateTime={record.publishedAt}>{dateText(record.publishedAt)}</time></span>
          <strong>{record.title}</strong><span className="record-locator">{locatorText(record.locator)}</span>
        </button>)}
      </nav>
      {selected && <article className="detail-panel">
        <p className="eyebrow">{selected.locationLabel} · {sourceLabel[selected.sourceKind]}</p>
        <h2>{selected.title}</h2>
        <dl className="detail-meta"><div><dt>Publisher</dt><dd>{selected.publisher}</dd></div><div><dt>Published</dt><dd><time dateTime={selected.publishedAt}>{dateText(selected.publishedAt)}</time></dd></div></dl>
        {selected.sourceKind === "reporting" && <p className="reporting-label">Reporting, not the primary record</p>}
        <section className="quote-block"><p className="eyebrow">EXACT SOURCE EXCERPT</p><blockquote>“{selected.exactQuote}”</blockquote></section>
        <p className="citation-text"><strong>Citation</strong> {citation}</p>
        <div className="detail-actions"><a href={selected.canonicalUrl} target="_blank" rel="noreferrer">Open public record <span aria-hidden="true">↗</span></a><button type="button" onClick={() => { setCopyError(false); if (!navigator.clipboard) setCopyError(true); else navigator.clipboard.writeText(citation ?? "").catch(() => setCopyError(true)); }}>Copy citation</button></div>
        {copyError && <p className="copy-error" role="status">Couldn’t copy citation. Select the citation text instead.</p>}
      </article>}
    </section>
  </main>;
}
