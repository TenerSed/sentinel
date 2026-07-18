import { useEffect, useMemo, useState } from "react";
import { demoSeed } from "./demo-seed";
import type { DemoSeed, EvidenceLocator, EvidenceRecord, SourceKind, UpdateType } from "./types";

type SeedState = { status: "loading" } | { status: "error"; diagnostic: string } | { status: "ready"; seed: DemoSeed };

const sourceLabel: Record<SourceKind, string> = {
  government_record: "Primary record",
  video_transcript: "Primary record",
  reporting: "Reporting",
};

const updateLabel: Record<UpdateType, string> = {
  legislation: "Legislation",
  office_holder: "Office-holder",
  policy: "Policy",
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
  if (candidate.version !== 1 || !Array.isArray(candidate.locations) || !Array.isArray(candidate.coverage) || !Array.isArray(candidate.records)) throw new Error("Bundled seed has an unsupported shape.");
  const locationIds = new Set(candidate.locations.map((location) => location.id));
  if (!locationIds.size || candidate.coverage.some((coverage) => !locationIds.has(coverage.locationId) || !locationIds.has(coverage.coveredLocationId))) throw new Error("Bundled seed contains invalid coverage.");
  for (const record of candidate.records) {
    if (!record || typeof record !== "object") throw new Error("Bundled seed contains an unreadable record.");
    const item = record as Partial<EvidenceRecord>;
    if (![item.id, item.locationId, item.locationLabel, item.publisher, item.sourceTitle, item.title, item.publishedAt, item.canonicalUrl, item.exactQuote].every((value) => typeof value === "string" && value.trim())) throw new Error("Bundled seed record is missing required evidence fields.");
    const url = item.canonicalUrl as string;
    const quote = item.exactQuote as string;
    if (!locationIds.has(item.locationId ?? "") || !["legislation", "office_holder", "policy"].includes(item.updateType ?? "") || !["government_record", "video_transcript", "reporting"].includes(item.sourceKind ?? "") || !url.startsWith("https://") || quote.trim().split(/\s+/).length > 25) throw new Error("Bundled seed record did not pass evidence validation.");
    if (!item.locator || (item.locator.kind === "page" && (!Number.isInteger(item.locator.pageNumber) || item.locator.pageNumber < 1)) || (item.locator.kind === "timestamp" && (!Number.isInteger(item.locator.startSeconds) || item.locator.startSeconds < 0))) throw new Error("Bundled seed record is missing a reliable locator.");
  }
  return candidate as DemoSeed;
}

export default function App() {
  const [state, setState] = useState<SeedState>({ status: "loading" });
  const [coverageId, setCoverageId] = useState("indy");
  const [selectedId, setSelectedId] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const [futureMessage, setFutureMessage] = useState("");

  useEffect(() => {
    try {
      setState({ status: "ready", seed: validateSeed(demoSeed) });
    } catch (error) {
      setState({ status: "error", diagnostic: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const coverage = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.seed.coverage.filter((entry) => entry.locationId === coverageId).map((entry) => entry.coveredLocationId);
  }, [state, coverageId]);
  const records = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.seed.records.filter((record) => coverage.includes(record.locationId));
  }, [state, coverage]);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const location = state.status === "ready" ? state.seed.locations.find((item) => item.id === coverageId) : undefined;

  if (state.status === "loading") return <main className="state-page" aria-live="polite">Validating bundled evidence…</main>;
  if (state.status === "error") return <main className="state-page error-state"><h1>Bundled evidence could not be validated.</h1><p>This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.</p><pre>{state.diagnostic}</pre></main>;

  const citation = selected && `${selected.sourceTitle} · ${locatorText(selected.locator)}`;
  const label = location?.label ?? "configured coverage";
  return <main className="recent-shell">
    <header className="recent-header">
      <p className="eyebrow">LAMPLIGHTER / OFFLINE DEMO</p>
      <h1>Recent government updates</h1>
      <p>Source-grounded public records for the coverage you selected.</p>
      <label className="coverage-control">Coverage<select value={coverageId} onChange={(event) => { setCoverageId(event.target.value); setSelectedId(undefined); setCopyError(false); setFutureMessage(""); }}>
        {state.seed.locations.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
      <div className="seed-status"><span aria-hidden="true" />Seed ready · offline · no API key required</div>
    </header>
    <section className="evidence-grid" aria-label="Recent government updates">
      <section className="record-list" aria-labelledby="recent-heading">
        <div className="panel-heading"><p className="eyebrow">VERIFIED UPDATES</p><h2 id="recent-heading">Recent in {label}</h2><p>{records.length} {records.length === 1 ? "update" : "updates"}</p></div>
        {records.length ? records.map((record) => <button type="button" key={record.id} className={`record-row ${record.id === selected?.id ? "selected" : ""}`} aria-pressed={record.id === selected?.id} onClick={() => { setSelectedId(record.id); setCopyError(false); setFutureMessage(""); }}>
          <span className="record-meta">{record.locationLabel} · {sourceLabel[record.sourceKind]} · <time dateTime={record.publishedAt}>{dateText(record.publishedAt)}</time></span>
          <span className="record-tags"><span>{updateLabel[record.updateType]}</span><span>{sourceLabel[record.sourceKind]}</span></span>
          <strong>{record.title}</strong><span className="quote-preview">“{record.exactQuote}”</span><span className="record-locator">{locatorText(record.locator)}</span>
        </button>) : <div className="empty-state"><h2>No verified updates for {label}</h2><p>Lamplighter will not broaden coverage or substitute other records. Choose another configured coverage to inspect its bundled public records.</p></div>}
      </section>
      {selected && <article className="detail-panel">
        <p className="eyebrow">{selected.locationLabel} · {sourceLabel[selected.sourceKind]}</p>
        <h2>{selected.title}</h2>
        <dl className="detail-meta"><div><dt>Update type</dt><dd>{updateLabel[selected.updateType]}</dd></div><div><dt>Publisher</dt><dd>{selected.publisher}</dd></div><div><dt>Published</dt><dd><time dateTime={selected.publishedAt}>{dateText(selected.publishedAt)}</time></dd></div></dl>
        {selected.sourceKind === "reporting" && <p className="reporting-label">Reporting, not the primary record</p>}
        <section className="quote-block"><p className="eyebrow">EXACT SOURCE EXCERPT</p><blockquote>“{selected.exactQuote}”</blockquote></section>
        <p className="citation-text"><strong>Citation</strong> {citation}</p>
        <div className="detail-actions"><a href={selected.canonicalUrl} target="_blank" rel="noreferrer">Open public record <span aria-hidden="true">↗</span></a><button type="button" onClick={() => { setCopyError(false); if (!navigator.clipboard) setCopyError(true); else navigator.clipboard.writeText(citation ?? "").catch(() => setCopyError(true)); }}>Copy citation</button></div>
        {copyError && <p className="copy-error" role="status">Couldn’t copy citation. Select the citation text instead.</p>}
      </article>}
    </section>
    {futureMessage && <p className="future-message" role="status" aria-live="polite">{futureMessage}</p>}
    <nav className="bottom-nav" aria-label="Lamplighter sections"><button type="button" aria-current="page">Recent <span>Active</span></button><button type="button" onClick={() => setFutureMessage("Curated is coming in a later phase.")}>Curated <span>Unavailable</span></button><button type="button" onClick={() => setFutureMessage("Chat is coming in a later phase.")}>Chat <span>Unavailable</span></button></nav>
  </main>;
}
