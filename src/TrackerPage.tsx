import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "./AuthContext";

export type CaseSummary = {
  case_number: string;
  headline: string;
  what_it_is: string;
  status: "APPROVED" | "PENDING" | "DENIED" | "WITHDRAWN" | "TABLED";
  address: string | null;
  applicant: string | null;
  attorney: string | null;
  vote: string | null;
  meeting_date: string | null;
  has_video: boolean;
  has_opposition: boolean;
  lat: number | null;
  lng: number | null;
  distance_mi?: number | null;
};

type Status = CaseSummary["status"];
type CaseType = "RZ" | "PUD" | "VA" | "SE" | "ANX" | "TA";
type Sort = "case" | "status" | "date" | "distance";
type View = "list" | "map";

const statusOptions: [Status, string][] = [["APPROVED", "Approved"], ["PENDING", "Pending"], ["DENIED", "Denied"], ["WITHDRAWN", "Withdrawn"], ["TABLED", "Tabled"]];
const typeOptions: [CaseType, string][] = [["RZ", "Rezoning"], ["PUD", "PUD"], ["VA", "Variance"], ["SE", "Special Exception"], ["ANX", "Annexation"], ["TA", "Text amendment"]];
const mapColors: Record<Status, string> = { APPROVED: "#9a3f2b", PENDING: "#c48724", DENIED: "#6d706d", WITHDRAWN: "#42665b", TABLED: "#776652" };
const typeOf = (item: CaseSummary) => (item.case_number.match(/^([A-Z]+)/)?.[1] || "").toUpperCase();
const dateValue = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const dateLabel = (value: string | null) => value && dateValue(value) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";
const statusLabel = (value: Status) => statusOptions.find(([key]) => key === value)?.[1] || value;

function FitMarkers({ items }: { items: CaseSummary[] }) {
  const map = useMap();
  useEffect(() => {
    const points = items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)).map((item) => [item.lat!, item.lng!] as [number, number]);
    if (points.length) map.fitBounds(points, { maxZoom: 14, padding: [28, 28] });
  }, [items, map]);
  return null;
}

function parseIntent(value: string) {
  const lower = value.toLowerCase();
  const statuses = new Set<Status>();
  const types = new Set<CaseType>();
  if (/\bapproved?\b/.test(lower)) statuses.add("APPROVED");
  if (/\bpending|upcoming\b/.test(lower)) statuses.add("PENDING");
  if (/\bdenied|rejected\b/.test(lower)) statuses.add("DENIED");
  if (/\bwithdrawn?\b/.test(lower)) statuses.add("WITHDRAWN");
  if (/\btabled|continued\b/.test(lower)) statuses.add("TABLED");
  if (/\brezon(?:e|ing)s?\b/.test(lower)) types.add("RZ");
  if (/\bpuds?\b/.test(lower)) types.add("PUD");
  if (/\bvariances?\b/.test(lower)) types.add("VA");
  if (/\bspecial exceptions?\b/.test(lower)) types.add("SE");
  if (/\bannexations?\b/.test(lower)) types.add("ANX");
  if (/\btext amendments?\b/.test(lower)) types.add("TA");
  const opposition = /\bwith (?:public )?opposition\b|\bopposed\b/.test(lower);
  const video = /\bwith (?:a )?video\b|\bvideo receipt\b/.test(lower);
  const near = lower.match(/\bnear\s+([^,]+)$/i)?.[1]?.trim();
  let query = value;
  const phrases = [/\bapproved?\b/gi, /\bpending|upcoming\b/gi, /\bdenied|rejected\b/gi, /\bwithdrawn?\b/gi, /\btabled|continued\b/gi, /\brezon(?:e|ing)s?\b/gi, /\bpuds?\b/gi, /\bvariances?\b/gi, /\bspecial exceptions?\b/gi, /\bannexations?\b/gi, /\btext amendments?\b/gi, /\bwith (?:public )?opposition\b|\bopposed\b/gi, /\bwith (?:a )?video(?: receipt)?\b/gi, /\bnear\s+[^,]+$/gi];
  for (const phrase of phrases) query = query.replace(phrase, " ");
  return { statuses, types, opposition, video, near, query: query.replace(/\s+/g, " ").trim() };
}

export default function TrackerPage() {
  const { tracked, toggleTracked } = useAuth();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [statuses, setStatuses] = useState<Set<Status>>(new Set());
  const [types, setTypes] = useState<Set<CaseType>>(new Set());
  const [videoOnly, setVideoOnly] = useState(false);
  const [oppositionOnly, setOppositionOnly] = useState(false);
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("date");
  const [view, setView] = useState<View>("list");
  const [address, setAddress] = useState("");
  const [addressMatches, setAddressMatches] = useState<string[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");

  useEffect(() => {
    fetch("/api/cases?sort=recent").then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload)) throw new Error();
      return payload as CaseSummary[];
    }).then((payload) => { setCases(payload); setState("ready"); }).catch(() => setState("error"));
  }, []);

  useEffect(() => {
    const value = address.trim();
    if (value.length < 2) { setAddressMatches([]); return; }
    const timer = window.setTimeout(() => fetch(`/api/near/addresses?q=${encodeURIComponent(value)}&limit=7`).then((r) => r.json()).then((payload: { addresses?: string[] }) => setAddressMatches(payload.addresses || [])).catch(() => setAddressMatches([])), 140);
    return () => window.clearTimeout(timer);
  }, [address]);

  const chooseAddress = (value: string) => {
    setAddress(value); setSelectedAddress(value); setAddressMatches([]); setSort("distance");
    fetch(`/api/cases?sort=distance&address=${encodeURIComponent(value)}`).then((r) => r.json()).then((items: CaseSummary[]) => {
      const distances = new Map(items.map((item) => [item.case_number, item.distance_mi]));
      setCases((current) => current.map((item) => ({ ...item, distance_mi: distances.get(item.case_number) ?? null })));
    }).catch(() => undefined);
  };

  const match = (item: CaseSummary, omit?: "status" | "type" | "video" | "opposition" | "tracked") => {
    const needle = query.toLowerCase();
    return (omit === "status" || !statuses.size || statuses.has(item.status)) &&
      (omit === "type" || !types.size || types.has(typeOf(item) as CaseType)) &&
      (omit === "video" || !videoOnly || item.has_video) &&
      (omit === "opposition" || !oppositionOnly || item.has_opposition) &&
      (omit === "tracked" || !trackedOnly || tracked.has(item.case_number)) &&
      (!needle || `${item.case_number} ${item.headline} ${item.what_it_is} ${item.address || ""} ${item.applicant || ""} ${item.attorney || ""}`.toLowerCase().includes(needle));
  };
  const visible = useMemo(() => cases.filter((item) => match(item)).sort((a, b) => {
    if (sort === "case") return a.case_number.localeCompare(b.case_number, undefined, { numeric: true });
    if (sort === "status") return a.status.localeCompare(b.status) || a.case_number.localeCompare(b.case_number, undefined, { numeric: true });
    if (sort === "distance") return (a.distance_mi ?? Infinity) - (b.distance_mi ?? Infinity) || a.case_number.localeCompare(b.case_number, undefined, { numeric: true });
    return dateValue(b.meeting_date) - dateValue(a.meeting_date) || b.case_number.localeCompare(a.case_number, undefined, { numeric: true });
  }), [cases, query, statuses, types, videoOnly, oppositionOnly, trackedOnly, tracked, sort]);
  const countFor = (predicate: (item: CaseSummary) => boolean, omit: Parameters<typeof match>[1]) => cases.filter((item) => match(item, omit) && predicate(item)).length;
  const toggleSet = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) => setter((current) => { const next = new Set(current); next.has(value) ? next.delete(value) : next.add(value); return next; });
  const clear = () => { setQuery(""); setSearchInput(""); setStatuses(new Set()); setTypes(new Set()); setVideoOnly(false); setOppositionOnly(false); setTrackedOnly(false); setAddress(""); setSelectedAddress(""); setSort("date"); };
  const applySearch = (event: FormEvent) => {
    event.preventDefault(); const parsed = parseIntent(searchInput); setQuery(parsed.query); if (parsed.statuses.size) setStatuses(parsed.statuses); if (parsed.types.size) setTypes(parsed.types); if (parsed.opposition) setOppositionOnly(true); if (parsed.video) setVideoOnly(true); if (parsed.near) {
      setAddress(parsed.near); setSelectedAddress("");
      fetch(`/api/near/addresses?q=${encodeURIComponent(parsed.near)}&limit=1`).then((r) => r.json()).then((payload: { addresses?: string[] }) => { if (payload.addresses?.[0]) chooseAddress(payload.addresses[0]); }).catch(() => undefined);
    }
  };
  const chips: { label: string; remove: () => void }[] = [
    ...(statuses.size ? [{ label: [...statuses].map(statusLabel).join(", "), remove: () => setStatuses(new Set()) }] : []),
    ...(types.size ? [{ label: [...types].join(", "), remove: () => setTypes(new Set()) }] : []),
    ...(videoOnly ? [{ label: "Has video", remove: () => setVideoOnly(false) }] : []),
    ...(oppositionOnly ? [{ label: "Has opposition", remove: () => setOppositionOnly(false) }] : []),
    ...(trackedOnly ? [{ label: "Tracked", remove: () => setTrackedOnly(false) }] : []),
    ...(selectedAddress ? [{ label: `Near ${selectedAddress}`, remove: () => { setAddress(""); setSelectedAddress(""); setSort("date"); } }] : []),
  ];
  const openCase = (item: CaseSummary) => { window.location.href = `/case?case=${encodeURIComponent(item.case_number)}`; };
  const rowKey = (event: KeyboardEvent<HTMLDivElement>, item: CaseSummary) => { if (event.key === "Enter") openCase(item); };

  return <main className="tracker-page">
    <header className="tool-heading"><div><p className="eyebrow">CASE TRACKER</p><h1>Fishers land-use cases</h1><p>Filter, sort, map, and watch the complete cached public-record set.</p></div><a href="/feed">Government updates →</a></header>
    <div className="tracker-layout">
      <aside className="tracker-sidebar" aria-label="Case filters">
        <div className="tracker-filter-heading"><div><p>FILTER CASES</p><strong>Public record</strong></div><button onClick={clear}>Clear all</button></div>
        <fieldset><legend>Status</legend>{statusOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={statuses.has(value)} onChange={() => toggleSet(setStatuses, value)} /><span>{label}</span><b>{countFor((item) => item.status === value, "status")}</b></label>)}</fieldset>
        <fieldset><legend>Case type</legend>{typeOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={types.has(value)} onChange={() => toggleSet(setTypes, value)} /><span><code>{value}</code> {label}</span><b>{countFor((item) => typeOf(item) === value, "type")}</b></label>)}</fieldset>
        <fieldset><legend>Record features</legend><label><input type="checkbox" checked={videoOnly} onChange={() => setVideoOnly((x) => !x)} /><span>Has video receipt</span><b>{countFor((item) => item.has_video, "video")}</b></label><label><input type="checkbox" checked={oppositionOnly} onChange={() => setOppositionOnly((x) => !x)} /><span>Public opposition</span><b>{countFor((item) => item.has_opposition, "opposition")}</b></label></fieldset>
        <fieldset><legend>Watchlist</legend><label><input type="checkbox" checked={trackedOnly} onChange={() => setTrackedOnly((x) => !x)} /><span>Tracked ({tracked.size})</span><b>{countFor((item) => tracked.has(item.case_number), "tracked")}</b></label></fieldset>
        <div className="tracker-address"><label htmlFor="tracker-address">Sort by distance</label><input id="tracker-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Start typing an address" autoComplete="off" />{addressMatches.length > 0 && <ul>{addressMatches.map((item) => <li key={item}><button onClick={() => chooseAddress(item)}>{item}</button></li>)}</ul>}<small>{selectedAddress ? `Distances from ${selectedAddress}` : "Choose a suggested Fishers address."}</small></div>
      </aside>
      <section className="tracker-results">
        <div className="tracker-toolbar"><form onSubmit={applySearch}><label htmlFor="tracker-search">Search cases</label><div><input id="tracker-search" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder='Case, applicant, address, or “variances with opposition”' /><button>Search</button></div></form><div className="tracker-view-toggle" aria-label="Result view"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ List</button><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>⌖ Map view</button></div></div>
        <div className="tracker-result-meta"><strong>{state === "ready" ? `${visible.length} case${visible.length === 1 ? "" : "s"}` : "Loading cases…"}</strong><span>Cached public-record snapshot</span></div>
        {chips.length > 0 && <div className="tracker-applied" aria-label="Applied filters">{chips.map((chip) => <button key={chip.label} onClick={chip.remove}>{chip.label} ×</button>)}</div>}
        {state === "error" && <div className="tracker-error" role="alert">The cached case catalog could not be loaded.</div>}
        {view === "map" && state === "ready" ? <div className="tracker-map"><MapContainer center={[39.9568, -86.0125]} zoom={12} className="tracker-leaflet"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><FitMarkers items={visible} />{visible.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)).map((item) => <CircleMarker key={item.case_number} center={[item.lat!, item.lng!]} radius={7} pathOptions={{ color: "#fffdf8", weight: 2, fillColor: mapColors[item.status], fillOpacity: .92 }}><Popup><div className="tracker-popup"><code>{item.case_number}</code><strong>{item.headline}</strong><span>{statusLabel(item.status)}</span><a href={`/case?case=${encodeURIComponent(item.case_number)}`}>Open record →</a></div></Popup></CircleMarker>)}</MapContainer><div className="tracker-map-note">{visible.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)).length} of {visible.length} filtered cases have mapped coordinates.</div></div> : <div className="tracker-table-wrap"><div className="tracker-table-header" role="row"><span aria-label="Watchlist" /><button onClick={() => setSort("case")}>Case {sort === "case" ? "↑" : ""}</button><span>Title / applicant</span><button onClick={() => setSort("status")}>Status {sort === "status" ? "↑" : ""}</button><span>Address</span><button onClick={() => setSort("date")}>Date {sort === "date" ? "↓" : ""}</button><button disabled={!selectedAddress} onClick={() => setSort("distance")}>Distance {sort === "distance" ? "↑" : ""}</button><span>Record</span></div>{state === "loading" && Array.from({ length: 8 }, (_, i) => <div className="tracker-row tracker-row-loading" key={i} />)}{state === "ready" && visible.map((item) => <div className="tracker-row" role="link" tabIndex={0} aria-label={`Open ${item.case_number}: ${item.headline}`} key={item.case_number} onClick={() => openCase(item)} onKeyDown={(event) => rowKey(event, item)}><button className={`tracker-star ${tracked.has(item.case_number) ? "active" : ""}`} aria-label={`${tracked.has(item.case_number) ? "Stop tracking" : "Track"} ${item.case_number}`} aria-pressed={tracked.has(item.case_number)} onClick={(event) => { event.stopPropagation(); toggleTracked(item.case_number); }}>★</button><code>{item.case_number}</code><div className="tracker-title"><strong>{item.headline}</strong><small>{item.applicant || "Applicant not listed"}</small></div><span className={`tracker-status ${item.status}`}>{statusLabel(item.status)}</span><span className="tracker-cell-address">{item.address || "—"}</span><time>{dateLabel(item.meeting_date)}</time><span>{item.distance_mi != null ? `${item.distance_mi} mi` : "—"}</span><span className="tracker-record-icons"><i className={item.has_video ? "active" : ""} title={item.has_video ? "Video receipt available" : "No video receipt"}>▶</i><i className={item.has_opposition ? "active opposition" : ""} title={item.has_opposition ? "Public opposition recorded" : "No public opposition recorded"}>◉</i></span></div>)}{state === "ready" && !visible.length && <div className="tracker-empty"><strong>No cases match this view.</strong><button onClick={clear}>Clear filters</button></div>}</div>}
      </section>
    </div>
  </main>;
}
