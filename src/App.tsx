import { FormEvent, useEffect, useMemo, useState } from "react";
import { demoChatPresets, findBundledAnswer } from "./demo-chat";
import { demoSeed } from "./demo-seed";
import type { AnswerBlock, ChatProviderStatus, ChatThreads, ChatTurn, DemoSeed, EvidenceLocator, EvidenceRecord, GroundedAnswer, SourceKind, UpdateType } from "./types";

type SeedState = { status: "loading" } | { status: "error"; diagnostic: string } | { status: "ready"; seed: DemoSeed };
type LiveStatus = { available: boolean };
type ActiveTab = "recent" | "chat";

const storageKey = "lamplighter-chat-v1";
const insufficient: GroundedAnswer = { status: "insufficient", blocks: [] };

const sourceLabel: Record<SourceKind, string> = { government_record: "Primary record", video_transcript: "Primary record", reporting: "Reporting" };
const updateLabel: Record<UpdateType, string> = { legislation: "Legislation", office_holder: "Office-holder", policy: "Policy" };

function locatorText(locator: EvidenceLocator) {
  return locator.kind === "page" ? `p. ${locator.pageNumber}` : `${Math.floor(locator.startSeconds / 60)}:${String(locator.startSeconds % 60).padStart(2, "0")}`;
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

function coverageRecords(seed: DemoSeed, coverageId: string) {
  const covered = new Set(seed.coverage.filter((entry) => entry.locationId === coverageId).map((entry) => entry.coveredLocationId));
  return seed.records.filter((record) => covered.has(record.locationId)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

function validAnswer(value: unknown, packet: EvidenceRecord[]): GroundedAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return insufficient;
  const candidate = value as { status?: unknown; blocks?: unknown };
  if (Object.keys(candidate).length !== 2 || !("status" in candidate) || !("blocks" in candidate)) return insufficient;
  if (candidate.status === "insufficient" && Array.isArray(candidate.blocks) && candidate.blocks.length === 0) return insufficient;
  if (candidate.status !== "answered" || !Array.isArray(candidate.blocks) || !candidate.blocks.length || candidate.blocks.length > 4) return insufficient;
  const allowed = new Set(packet.map(({ id }) => id));
  const blocks: AnswerBlock[] = [];
  for (const block of candidate.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) return insufficient;
    const item = block as { text?: unknown; evidenceIds?: unknown };
    if (Object.keys(item).length !== 2 || !("text" in item) || !("evidenceIds" in item)) return insufficient;
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 500 || /[\n\r]/.test(item.text) || /[.!?][”"')\]]?\s+[A-Z0-9]/.test(item.text) || !Array.isArray(item.evidenceIds)) return insufficient;
    const evidenceIds = [...new Set(item.evidenceIds)];
    if (!evidenceIds.length || !evidenceIds.every((id) => typeof id === "string" && allowed.has(id))) return insufficient;
    blocks.push({ text: item.text.trim(), evidenceIds });
  }
  return { status: "answered", blocks: blocks as [AnswerBlock, ...AnswerBlock[]] };
}

function validProvider(value: unknown): ChatProviderStatus | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "bundled" && candidate.label === "Bundled demo answer") return { kind: "bundled", label: "Bundled demo answer" };
  if (candidate.kind === "live" && (candidate.provider === "OpenAI" || candidate.provider === "Anthropic" || candidate.provider === "Gemini")) return { kind: "live", provider: candidate.provider };
  if (candidate.kind === "unavailable") return { kind: "unavailable" };
  if (candidate.kind === "failed" && (candidate.provider === "OpenAI" || candidate.provider === "Anthropic" || candidate.provider === "Gemini") && typeof candidate.errorType === "string" && candidate.errorType.length < 80) return { kind: "failed", provider: candidate.provider, errorType: candidate.errorType };
  return undefined;
}

function isCandidatePositionRequest(question: string) {
  return /\b(candidate|office[- ]holder|mayor|governor|council(?:member)?|senator|representative)\b/i.test(question) && /\b(position|stance|view|views|stand|policy position|believe)\b/i.test(question);
}

function validStoredThreads(value: unknown, seed: DemoSeed): ChatThreads {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: ChatThreads = {};
  for (const [coverageId, turns] of Object.entries(value as Record<string, unknown>)) {
    const packet = coverageRecords(seed, coverageId).slice(0, 6);
    if (!packet.length || !Array.isArray(turns)) continue;
    const safeTurns: ChatTurn[] = [];
    for (const turn of turns) {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) continue;
      const item = turn as Partial<ChatTurn>;
      const provider = validProvider(item.provider);
      const answer = validAnswer(item.answer, packet);
      if (typeof item.question !== "string" || !item.question.trim() || item.coverageId !== coverageId || !provider || answer.status !== "answered" || item.packetCount !== packet.length || typeof item.createdAt !== "string" || Number.isNaN(Date.parse(item.createdAt))) continue;
      safeTurns.push({ question: item.question.trim(), coverageId, answer, provider, packetCount: packet.length, createdAt: item.createdAt });
    }
    if (safeTurns.length) output[coverageId] = safeTurns;
  }
  return output;
}

function failureTurn(question: string, coverageId: string, packetCount: number, provider: ChatProviderStatus = { kind: "unavailable" }): ChatTurn {
  return { question, coverageId, answer: insufficient, provider, packetCount, createdAt: new Date().toISOString() };
}

function AnswerView({ turn, records, onCitation }: { turn: ChatTurn; records: EvidenceRecord[]; onCitation: (id: string) => void }) {
  const isAnswered = turn.answer.status === "answered";
  return <article className={`chat-turn ${isAnswered ? "chat-answer" : "chat-refusal"}`}>
    <p className="chat-question">{turn.question}</p>
    {isAnswered ? <>
      <p className="answer-status">{turn.provider.kind === "bundled" ? "Bundled demo answer" : turn.provider.kind === "live" ? turn.provider.provider : "Grounded answer"}</p>
      {turn.answer.blocks.map((block, index) => <div className={index ? "answer-bullet" : "answer-direct"} key={`${turn.createdAt}-${index}`}>
        {index ? <span aria-hidden="true">•</span> : null}<span>{block.text}</span>{block.evidenceIds.map((id) => {
          const record = records.find((item) => item.id === id);
          return record ? <button type="button" className="citation-chip" key={id} onClick={() => onCitation(id)} aria-label={`Open evidence: ${record.sourceTitle}, ${locatorText(record.locator)}`}>{record.sourceTitle} · {locatorText(record.locator)}</button> : null;
        })}
      </div>)}
      {turn.provider.kind === "live" && <p className="answer-boundary">Based only on {turn.packetCount} surfaced records for {turn.coverageId === "indy" ? "Indianapolis" : turn.coverageId === "indiana" ? "Indiana" : "U.S. federal"}.</p>}
    </> : <>
      {turn.provider.kind === "failed" && <p className="provider-failure" role="status">{turn.provider.provider} unavailable ({turn.provider.errorType}).</p>}
      <p className="insufficient-copy">I can’t answer that from the selected public records yet,</p>
    </>}
  </article>;
}

export default function App() {
  const [state, setState] = useState<SeedState>({ status: "loading" });
  const [coverageId, setCoverageId] = useState("indy");
  const [selectedId, setSelectedId] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const [futureMessage, setFutureMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("recent");
  const [live, setLive] = useState<LiveStatus>({ available: false });
  const [threads, setThreads] = useState<ChatThreads>({});
  const [storageReady, setStorageReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [showFindMore, setShowFindMore] = useState(false);

  useEffect(() => {
    try { setState({ status: "ready", seed: validateSeed(demoSeed) }); }
    catch (error) { setState({ status: "error", diagnostic: error instanceof Error ? error.message : String(error) }); }
  }, []);

  useEffect(() => {
    fetch("/api/chat/status").then((response) => response.ok ? response.json() : undefined).then((payload: unknown) => {
      const livePayload = payload && typeof payload === "object" ? (payload as { live?: unknown }).live : undefined;
      if (livePayload && typeof livePayload === "object" && (livePayload as { available?: unknown }).available === true) setLive({ available: true });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    try { setThreads(validStoredThreads(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"), state.seed)); }
    catch { setThreads({}); }
    setStorageReady(true);
  }, [state]);

  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(threads)); } catch { /* Storage is optional for the demo. */ }
  }, [storageReady, threads]);

  const records = useMemo(() => state.status === "ready" ? coverageRecords(state.seed, coverageId) : [], [state, coverageId]);
  const packet = useMemo(() => records.slice(0, 6), [records]);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const location = state.status === "ready" ? state.seed.locations.find((item) => item.id === coverageId) : undefined;
  const currentTurns = threads[coverageId] ?? [];
  const presets = demoChatPresets.filter((preset) => preset.coverageId === coverageId);
  const suggestionQuestions = [...presets.map(({ question: prompt }) => prompt), ...records.slice(0, 5).map((record) => `What does the public record say about ${record.title}?`)].filter((prompt, index, list) => list.indexOf(prompt) === index).slice(0, 5);

  const appendTurn = (turn: ChatTurn) => {
    if (validAnswer(turn.answer, packet).status !== "answered" && turn.answer.status !== "insufficient") return;
    setThreads((current) => ({ ...current, [coverageId]: [...(current[coverageId] ?? []), turn] }));
  };

  const submitQuestion = async (event?: FormEvent, prompt = question) => {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || asking) return;
    setQuestion("");
    setShowFindMore(false);
    const candidateBlocked = isCandidatePositionRequest(text) && !packet.some((record) => record.evidenceKind === "recent_public_position");
    if (candidateBlocked) return appendTurn(failureTurn(text, coverageId, packet.length));
    const preset = findBundledAnswer(coverageId, text);
    if (preset) {
      const answer = validAnswer(preset.answer, packet);
      return appendTurn(answer.status === "answered" ? { question: text, coverageId, answer, provider: preset.provider, packetCount: packet.length, createdAt: new Date().toISOString() } : failureTurn(text, coverageId, packet.length));
    }
    if (!live.available) return appendTurn(failureTurn(text, coverageId, packet.length));
    setAsking(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coverageId, question: text }) });
      const payload: unknown = await response.json();
      const result = payload && typeof payload === "object" ? payload as { answer?: unknown; packet?: { coverageId?: unknown; count?: unknown }; provider?: unknown; error?: unknown } : {};
      const answer = validAnswer(result.answer, packet);
      const provider = validProvider({ kind: "live", provider: result.provider });
      const packetMatches = result.packet?.coverageId === coverageId && result.packet?.count === packet.length;
      const error = result.error && typeof result.error === "object" ? result.error as { provider?: unknown; type?: unknown } : undefined;
      const failed = error ? validProvider({ kind: "failed", provider: error.provider, errorType: typeof error.type === "string" ? error.type.slice(0, 80) : "" }) : undefined;
      appendTurn(answer.status === "answered" && provider && packetMatches ? { question: text, coverageId, answer, provider, packetCount: packet.length, createdAt: new Date().toISOString() } : failureTurn(text, coverageId, packet.length, failed));
    } catch {
      appendTurn(failureTurn(text, coverageId, packet.length));
    } finally { setAsking(false); }
  };

  if (state.status === "loading") return <main className="state-page" aria-live="polite">Validating bundled evidence…</main>;
  if (state.status === "error") return <main className="state-page error-state"><h1>Bundled evidence could not be validated.</h1><p>This demo will not fetch or rebuild data automatically. Check the seed diagnostics, then run the documented seed command.</p><pre>{state.diagnostic}</pre></main>;

  const citation = selected && `${selected.sourceTitle} · ${locatorText(selected.locator)}`;
  const label = location?.label ?? "configured coverage";
  const selectCoverage = (value: string) => { setCoverageId(value); setSelectedId(undefined); setCopyError(false); setFutureMessage(""); setShowFindMore(false); };
  const detailPanel = selected ? <article className="detail-panel">
    <p className="eyebrow">{selected.locationLabel} · {sourceLabel[selected.sourceKind]}</p><h2>{selected.title}</h2>
    <dl className="detail-meta"><div><dt>Update type</dt><dd>{updateLabel[selected.updateType]}</dd></div><div><dt>Publisher</dt><dd>{selected.publisher}</dd></div><div><dt>Published</dt><dd><time dateTime={selected.publishedAt}>{dateText(selected.publishedAt)}</time></dd></div></dl>
    {selected.sourceKind === "reporting" && <p className="reporting-label">Reporting, not the primary record</p>}
    <section className="quote-block"><p className="eyebrow">EXACT SOURCE EXCERPT</p><blockquote>“{selected.exactQuote}”</blockquote></section><p className="citation-text"><strong>Citation</strong> {citation}</p>
    <div className="detail-actions"><a href={selected.canonicalUrl} target="_blank" rel="noreferrer">Open public record <span aria-hidden="true">↗</span></a><button type="button" onClick={() => { setCopyError(false); if (!navigator.clipboard) setCopyError(true); else navigator.clipboard.writeText(citation ?? "").catch(() => setCopyError(true)); }}>Copy citation</button></div>
    {copyError && <p className="copy-error" role="status">Couldn’t copy citation. Select the citation text instead.</p>}
  </article> : null;

  return <main className="recent-shell">
    <header className="recent-header"><p className="eyebrow">LAMPLIGHTER / OFFLINE DEMO</p><h1>{activeTab === "chat" ? "Ask about public records" : "Recent government updates"}</h1><p>{activeTab === "chat" ? "Answers stay inside the coverage and surfaced records you selected." : "Source-grounded public records for the coverage you selected."}</p>
      <label className="coverage-control">Coverage<select value={coverageId} onChange={(event) => selectCoverage(event.target.value)}>{state.seed.locations.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <div className="seed-status"><span aria-hidden="true" />{activeTab === "chat" ? live.available ? "Live AI available · bundled demos ready" : "Live AI unavailable · bundled demos ready" : "Seed ready · offline · no API key required"}</div>
    </header>
    {activeTab === "recent" ? <section className="evidence-grid" aria-label="Recent government updates"><section className="record-list" aria-labelledby="recent-heading"><div className="panel-heading"><p className="eyebrow">VERIFIED UPDATES</p><h2 id="recent-heading">Recent in {label}</h2><p>{records.length} {records.length === 1 ? "update" : "updates"}</p></div>
      {records.length ? records.map((record) => <button type="button" key={record.id} className={`record-row ${record.id === selected?.id ? "selected" : ""}`} aria-pressed={record.id === selected?.id} onClick={() => { setSelectedId(record.id); setCopyError(false); setFutureMessage(""); }}><span className="record-meta">{record.locationLabel} · {sourceLabel[record.sourceKind]} · <time dateTime={record.publishedAt}>{dateText(record.publishedAt)}</time></span><span className="record-tags"><span>{updateLabel[record.updateType]}</span><span>{sourceLabel[record.sourceKind]}</span></span><strong>{record.title}</strong><span className="quote-preview">“{record.exactQuote}”</span><span className="record-locator">{locatorText(record.locator)}</span></button>) : <div className="empty-state"><h2>No verified updates for {label}</h2><p>Lamplighter will not broaden coverage or substitute other records. Choose another configured coverage to inspect its bundled public records.</p></div>}</section>{detailPanel}</section> : <section className="chat-grid" aria-label={`Grounded chat for ${label}`}><section className="chat-thread"><div className="panel-heading"><p className="eyebrow">CLOSED EVIDENCE PACKET</p><h2>Ask about {label}</h2><p>{packet.length} surfaced records · citations open the source panel</p></div><section className="suggestion-list" aria-label="Suggested questions"><p className="eyebrow">SUGGESTED QUESTIONS</p>{suggestionQuestions.map((prompt) => <button type="button" key={prompt} onClick={() => void submitQuestion(undefined, prompt)} disabled={asking}>{prompt}</button>)}</section>
      <div className="turn-list" aria-live="polite">{currentTurns.length ? currentTurns.map((turn) => <AnswerView key={`${turn.createdAt}-${turn.question}`} turn={turn} records={packet} onCitation={(id) => { setSelectedId(id); setCopyError(false); }} />) : <p className="empty-chat">Choose a suggested question or ask about these records. Unsupported questions stay unanswered rather than expanding the source set.</p>}</div>
      {currentTurns.some((turn) => turn.answer.status === "insufficient") && <section className="refusal-actions"><p>Try a suggested question grounded in the selected records.</p><button type="button" onClick={() => setShowFindMore((visible) => !visible)} aria-expanded={showFindMore}>Find more sources</button>{showFindMore && <p className="find-more-copy">Evidence expansion is not available in this demo. Lamplighter will not search or substitute reporting while answering.</p>}</section>}
      <form className="chat-composer" onSubmit={(event) => void submitQuestion(event)}><label htmlFor="chat-question">Ask a question about {label}</label><textarea id="chat-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a cited update…" rows={2} disabled={asking} /><button type="submit" disabled={asking || !question.trim()}>{asking ? "Checking records…" : "Ask"}</button></form></section>{detailPanel}</section>}
    {futureMessage && <p className="future-message" role="status" aria-live="polite">{futureMessage}</p>}
    <nav className="bottom-nav" aria-label="Lamplighter sections"><button type="button" aria-current={activeTab === "recent" ? "page" : undefined} onClick={() => { setActiveTab("recent"); setFutureMessage(""); }}>Recent <span>{activeTab === "recent" ? "Active" : "Updates"}</span></button><button type="button" onClick={() => setFutureMessage("Curated is coming in a later phase.")}>Curated <span>Unavailable</span></button><button type="button" aria-current={activeTab === "chat" ? "page" : undefined} onClick={() => { setActiveTab("chat"); setFutureMessage(""); }}>Chat <span>{activeTab === "chat" ? "Active" : "Grounded"}</span></button></nav>
  </main>;
}
