import { useEffect, useMemo, useState } from "react";
import type { CaseSummary } from "./TrackerPage";
import { useAuth } from "./AuthContext";

type Receipt = { kind: string; title: string; snippet: string; url?: string | null; videoId?: string; startSeconds?: number; case_number?: string };
type TrackRecord = { name: string; cases: number; approved: number; decided: number };
type Prediction = { approval_rate?: number; approved?: number; total?: number; forecast?: string; reasoning?: string; precedent_case_numbers?: string[]; precedents?: { case_number: string; status?: string; case_type?: string | null }[] };
type CaseQuote = { video_id: string; start_seconds: number; text: string; matched_on: "case number" | "address" | "applicant"; url: string };
type Detail = {
  case_number: string; title: string; status: CaseSummary["status"];
  facts: { case_type?: string | null; applicants?: TrackRecord[]; attorneys?: TrackRecord[]; parcels?: string[]; rezone_from?: string[]; rezone_to?: string[]; opposition?: string[] };
  sections: { what_it_is?: string; behind_it?: string; did_they_listen?: string; odds?: string; drafted_comment?: string; what_to_say?: string[] };
  meeting?: { board?: string | null; date?: string | null };
  vote?: { ayes?: number | null; nays?: number | null; text?: string | null };
  receipts: Receipt[]; video_receipt?: Receipt | null; prediction?: Prediction; quotes?: CaseQuote[];
};
type Tab = "overview" | "said" | "behind" | "votes" | "documents" | "action";

const tabs: [Tab, string][] = [["overview", "Overview"], ["said", "What was said"], ["behind", "Who's behind it"], ["votes", "Votes & Minutes"], ["documents", "Documents & Video"], ["action", "Take Action"]];
const statusText = (status: CaseSummary["status"]) => status === "TABLED" ? "Tabled" : status.charAt(0) + status.slice(1).toLowerCase();
const formatDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value)) : "Not listed in cached record";
const caseType = (caseNumber: string) => caseNumber.match(/^([A-Z]+)/)?.[1] || "";
const cleanCitation = (value?: string) => String(value || "").replace(/\s*\[case_number:[^\]]+\]\s*/gi, " ").replace(/\s+/g, " ").trim();
const sameName = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const source = receipt.url && /^(?:https?:)?\/\//.test(receipt.url) ? receipt.url : receipt.url ? `https://fishersin.portal.civicclerk.com/${receipt.url.replace(/^\//, "")}` : null;
  return <article className="record-receipt"><div><span>{receipt.kind === "video" ? "VIDEO RECEIPT" : "PUBLIC DOCUMENT"}</span><strong>{receipt.title}</strong></div>{receipt.kind === "video" && receipt.videoId ? <iframe title={receipt.title} src={`https://www.youtube-nocookie.com/embed/${receipt.videoId}?start=${Math.floor(receipt.startSeconds || 0)}`} allowFullScreen /> : null}<blockquote>“{receipt.snippet}”</blockquote>{source ? <a href={source} target="_blank" rel="noreferrer">Open original source ↗</a> : <small>Source locator unavailable in this cached record.</small>}</article>;
}

function Timeline({ status }: { status: CaseSummary["status"] }) {
  const stages = ["Filed", "Staff review", "Public hearing", "Board vote", "Decided"];
  const current = status === "APPROVED" || status === "DENIED" || status === "WITHDRAWN" ? 4 : status === "TABLED" ? 2 : 1;
  return <ol className="record-timeline" aria-label={`Case progress: ${statusText(status)}`}>{stages.map((stage, index) => <li className={index < current ? "complete" : index === current ? "current" : "future"} key={stage}><i aria-hidden="true" /><strong>{stage}</strong><small>{index < current ? "Reached" : index === current ? "Current stage" : "Not reached"}</small></li>)}</ol>;
}

export default function CasePage() {
  const { tracked: trackedCases, toggleTracked } = useAuth();
  const caseNumber = new URLSearchParams(window.location.search).get("case")?.trim() || "";
  const [detail, setDetail] = useState<Detail>();
  const [catalog, setCatalog] = useState<CaseSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("overview");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  useEffect(() => {
    Promise.all([fetch(`/api/near/case?case=${encodeURIComponent(caseNumber)}`).then(async (r) => { const x = await r.json(); if (!r.ok || x?.error) throw new Error(); return x as Detail; }), fetch("/api/cases?sort=recent").then((r) => r.json() as Promise<CaseSummary[]>)]).then(([record, cases]) => { setDetail(record); setDraft(String(record.sections?.drafted_comment || "")); setCatalog(Array.isArray(cases) ? cases : []); setState("ready"); }).catch(() => setState("error"));
  }, [caseNumber]);
  const currentSummary = catalog.find((item) => item.case_number === caseNumber);
  const similar = useMemo(() => {
    if (!detail) return [];
    const prefix = caseType(detail.case_number);
    return catalog.filter((item) => item.case_number !== detail.case_number).map((item) => ({ item, score: (caseType(item.case_number) === prefix ? 4 : 0) + (sameName(item.applicant, currentSummary?.applicant) ? 3 : 0) + (sameName(item.attorney, currentSummary?.attorney) ? 2 : 0) })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.item.case_number.localeCompare(b.item.case_number, undefined, { numeric: true })).slice(0, 5).map(({ item }) => item);
  }, [catalog, currentSummary, detail]);
  if (state === "loading") return <main className="record-page"><div className="record-state app-skeleton"><span className="resident-spinner" /> Loading cached case record…</div></main>;
  if (state === "error" || !detail) return <main className="record-page"><div className="record-state"><h1>Case record unavailable</h1><p>The cached case record or case catalog could not be loaded.</p><a href="/tracker">Return to tracker</a></div></main>;
  const index = catalog.findIndex((item) => item.case_number === detail.case_number);
  const previous = index > 0 ? catalog[index - 1] : null, next = index >= 0 && index < catalog.length - 1 ? catalog[index + 1] : null;
  const tracked = trackedCases.has(caseNumber);
  const applicants = detail.facts?.applicants || [], attorneys = detail.facts?.attorneys || [];
  const visibleTabs = detail.quotes?.length ? tabs : tabs.filter(([value]) => value !== "said");
  return <main className="record-page">
    <div className="record-shell">
      <nav className="record-breadcrumb"><a href="/tracker">← Case tracker</a><span>Fishers land use</span></nav>
      <header className="record-heading"><div><div className="record-eyebrow"><code>{detail.case_number}</code><span className={`tracker-status ${detail.status}`}>{statusText(detail.status)}</span></div><h1>{detail.title}</h1><p>{currentSummary?.address || detail.facts?.parcels?.[0] || "Address not listed in cached record"}</p></div><div className="record-heading-actions"><button onClick={() => navigator.clipboard.writeText(`${detail.title}\n${cleanCitation(detail.sections.did_they_listen)}\nVerified from public record · ${window.location.href}`).then(() => setSummaryCopied(true)).catch(() => setSummaryCopied(false))}>{summaryCopied ? "Summary copied" : "Share / Copy"}</button><button className={`record-track ${tracked ? "active" : ""}`} onClick={() => toggleTracked(caseNumber)} aria-pressed={tracked}>★ {tracked ? "Tracking" : "Track this case"}</button></div></header>
      <Timeline status={detail.status} />
      <div className="record-tabs" role="tablist" aria-label="Case record sections">{visibleTabs.map(([value, label]) => <button role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>
      <section className="record-panel" role="tabpanel">
        {tab === "overview" && <><div className="record-overview-grid"><article className="record-primary"><p className="record-kicker">WHAT IT IS</p><h2>{cleanCitation(detail.sections.what_it_is)}</h2><div className="record-facts"><div><span>Status</span><strong>{statusText(detail.status)}</strong></div><div><span>Case type</span><strong>{detail.facts?.case_type || caseType(detail.case_number) || "Not listed"}</strong></div><div><span>Applicant</span><strong>{applicants[0]?.name || currentSummary?.applicant || "Not listed"}</strong></div><div><span>Address</span><strong>{currentSummary?.address || detail.facts?.parcels?.[0] || "Not listed"}</strong></div><div><span>Meeting</span><strong>{formatDate(detail.meeting?.date)}</strong></div><div><span>Vote</span><strong>{detail.vote?.text || "Not recorded"}</strong></div></div></article><aside className="record-forecast"><p className="record-kicker">COMPARABLE-CASE FORECAST</p><strong>{detail.prediction?.approval_rate != null ? `${detail.prediction.approval_rate}%` : "Not available"}</strong><h2>{cleanCitation(detail.sections.odds)}</h2><p>{detail.prediction?.total != null ? `Computed from ${detail.prediction.total} comparable decided cases in the cached record; this is not a guarantee.` : "Computed from comparable decided cases retained in the cached record; this is not a guarantee."}</p>{detail.prediction?.precedent_case_numbers?.length ? <div>{detail.prediction.precedent_case_numbers.map((item) => <code key={item}>{item}</code>)}</div> : null}</aside></div><section className="record-similar"><div><p className="record-kicker">SIMILAR CASES</p><h2>Related cached records</h2></div>{similar.length ? <div>{similar.map((item) => <a key={item.case_number} href={`/case?case=${encodeURIComponent(item.case_number)}`}><code>{item.case_number}</code><strong>{item.headline}</strong><span>{statusText(item.status)} · {sameName(item.applicant, currentSummary?.applicant) ? "shared applicant" : sameName(item.attorney, currentSummary?.attorney) ? "shared attorney" : `same ${caseType(item.case_number)} case type`}</span></a>)}</div> : <p>No similar cases were found by case type or shared applicant/attorney.</p>}</section></>}
        {tab === "said" && <><div className="record-section-head"><p className="record-kicker">TIMESTAMPED MEETING TRANSCRIPTS</p><h2>What was actually said</h2><p>{detail.quotes?.length || 0} moments matched to this case from the complete public-meeting transcript corpus.</p></div><ol className="record-quote-timeline">{detail.quotes?.map((quote, index) => <li key={`${quote.video_id}-${quote.start_seconds}-${index}`}><div><time>{timestamp(quote.start_seconds)}</time><span>Matched on {quote.matched_on}</span></div><blockquote>“{quote.text}”</blockquote><a href={quote.url} target="_blank" rel="noreferrer">Watch this moment →</a></li>)}</ol></>}
        {tab === "behind" && <><div className="record-section-head"><p className="record-kicker">PARTIES OF RECORD</p><h2>Who's behind it</h2><p>{cleanCitation(detail.sections.behind_it)}</p></div><div className="record-party-grid"><section><h3>Applicants</h3>{applicants.length ? applicants.map((person) => <article key={person.name}><strong>{person.name}</strong><dl><div><dt>Cases</dt><dd>{person.cases}</dd></div><div><dt>Decided</dt><dd>{person.decided}</dd></div><div><dt>Approved</dt><dd>{person.approved}</dd></div></dl></article>) : <p>No applicant is listed.</p>}</section><section><h3>Attorneys</h3>{attorneys.length ? attorneys.map((person) => <article key={person.name}><strong>{person.name}</strong><dl><div><dt>Cases</dt><dd>{person.cases}</dd></div><div><dt>Decided</dt><dd>{person.decided}</dd></div><div><dt>Approved</dt><dd>{person.approved}</dd></div></dl></article>) : <p>No attorney is listed.</p>}</section></div><small className="record-method">Track records are computed from related, deduplicated cached graph records.</small></>}
        {tab === "votes" && <><div className="record-section-head"><p className="record-kicker">BOARD ACTION</p><h2>Votes &amp; Minutes</h2><p>{cleanCitation(detail.sections.did_they_listen)}</p></div><div className="record-vote-grid"><article><span>Vote tally</span><strong>{detail.vote?.text || "Not recorded"}</strong>{detail.vote?.ayes != null || detail.vote?.nays != null ? <p>{detail.vote?.ayes ?? 0} ayes · {detail.vote?.nays ?? 0} nays</p> : <p>No numeric tally in the cached record.</p>}</article><article><span>Meeting</span><strong>{detail.meeting?.board || "Board not listed"}</strong><p>{formatDate(detail.meeting?.date)}</p></article><article><span>Public record</span><strong>{detail.facts?.opposition?.length || 0} linked signals</strong>{detail.facts?.opposition?.length ? <ul>{detail.facts.opposition.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}</ul> : <p>No opposition signal is linked in this cached record.</p>}</article></div>{detail.video_receipt ? <ReceiptCard receipt={detail.video_receipt} /> : null}</>}
        {tab === "documents" && <><div className="record-section-head"><p className="record-kicker">SOURCE FILE</p><h2>Documents &amp; Video</h2><p>{detail.receipts.length} receipt{detail.receipts.length === 1 ? "" : "s"} retained with this cached case.</p></div><div className="record-receipt-list">{detail.receipts.map((receipt, i) => <ReceiptCard receipt={receipt} key={`${receipt.kind}-${receipt.title}-${i}`} />)}</div></>}
        {tab === "action" && <><div className="record-section-head"><p className="record-kicker">PUBLIC PARTICIPATION</p><h2>Take Action</h2><p>Use the cached facts below as a starting point and edit the comment in your own voice.</p></div><div className="record-action-grid"><section><label htmlFor="record-comment">Drafted public comment</label><textarea id="record-comment" value={draft} onChange={(event) => setDraft(event.target.value)} /><button onClick={() => navigator.clipboard.writeText(draft).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy comment"}</button></section><aside><h3>What to say</h3><ul>{(detail.sections.what_to_say || []).map((item, i) => <li key={`${item}-${i}`}>{cleanCitation(item)}</li>)}</ul><h3>Meeting</h3><p>{detail.meeting?.board || "Board not listed"}<br />{formatDate(detail.meeting?.date)}</p></aside></div></>}
      </section>
      <nav className="record-pagination" aria-label="Browse cases">{previous ? <a href={`/case?case=${encodeURIComponent(previous.case_number)}`}><span>← Previous case</span><strong>{previous.case_number}</strong></a> : <span />}{next ? <a href={`/case?case=${encodeURIComponent(next.case_number)}`}><span>Next case →</span><strong>{next.case_number}</strong></a> : <span />}</nav>
    </div>
  </main>;
}
