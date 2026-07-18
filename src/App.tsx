import { useMemo, useState } from "react";
import { signals } from "./data";
import type { Signal, SignalLevel } from "./types";

const levelClass: Record<SignalLevel, string> = {
  High: "level-high",
  Medium: "level-medium",
  Low: "level-low",
};

function SignalCard({ signal, selected, onSelect }: { signal: Signal; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`signal-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="card-topline">
        <span className={`level-dot ${levelClass[signal.level]}`} />
        <span>{signal.board}</span>
        <time>{signal.date}</time>
      </div>
      <h3>{signal.title}</h3>
      <p>{signal.body}</p>
      <div className="tag-row">
        {signal.tags.slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}
        <span className="stage">{signal.stage}</span>
      </div>
    </button>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(signals[0].id);
  const [filter, setFilter] = useState<"All" | SignalLevel>("All");
  const [query, setQuery] = useState("");
  const selected = signals.find((signal) => signal.id === selectedId) ?? signals[0];
  const filtered = useMemo(() => signals.filter((signal) => {
    const matchesFilter = filter === "All" || signal.level === filter;
    const haystack = `${signal.title} ${signal.body} ${signal.tags.join(" ")}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  }), [filter, query]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>Sentinel</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace">Atlas Compute <span>⌄</span></div>
        <nav>
          <a className="nav-item active" href="#radar"><span>◈</span> Intelligence radar</a>
          <a className="nav-item" href="#sources"><span>▤</span> Source coverage</a>
          <a className="nav-item" href="#alerts"><span>◉</span> Alert rules</a>
          <a className="nav-item" href="#reports"><span>▱</span> Reports</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="watching"><span className="pulse" /> Watching 3 bodies</div>
          <button className="profile-button">AC <span>Profile settings</span></button>
        </div>
      </aside>

      <section className="content" id="radar">
        <header className="topbar">
          <div><p className="eyebrow">INDIANAPOLIS / MARION COUNTY</p><h1>Intelligence radar</h1></div>
          <div className="topbar-actions"><button className="icon-button">⌕</button><button className="primary-button">+ Create report</button></div>
        </header>

        <section className="brief-card">
          <div className="brief-symbol">✦</div>
          <div><p className="eyebrow accent">THIS WEEK'S BRIEF</p><h2>The zoning conversation is moving from principles to process.</h2><p>New signals point to a more formal review path for data-center development, with infrastructure capacity and public hearings at the center.</p></div>
          <button className="brief-button">Read brief <span>→</span></button>
        </section>

        <section className="metrics">
          <div className="metric"><span>NEW SIGNALS</span><strong>04</strong><small>↑ 2 since last week</small></div>
          <div className="metric"><span>HIGH PRIORITY</span><strong>02</strong><small>Needs review today</small></div>
          <div className="metric"><span>UPCOMING MEETINGS</span><strong>03</strong><small>Next: Jul 22, 1:00 PM</small></div>
        </section>

        <section className="radar-grid">
          <div className="signal-list-panel">
            <div className="section-heading"><div><p className="eyebrow">MONITORED POLICY DEVELOPMENTS</p><h2>Signals requiring attention</h2></div><span className="count">{filtered.length} signals</span></div>
            <div className="filter-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search signals" />{(["All", "High", "Medium"] as const).map((item) => <button key={item} className={`filter ${filter === item ? "filter-active" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
            <div className="signal-list">{filtered.map((signal) => <SignalCard key={signal.id} signal={signal} selected={signal.id === selected.id} onSelect={() => setSelectedId(signal.id)} />)}{filtered.length === 0 && <p className="empty">No matching signals.</p>}</div>
          </div>

          <aside className="detail-panel">
            <div className="detail-header"><span className={`level-pill ${levelClass[selected.level]}`}>{selected.level} priority</span><button className="more-button">•••</button></div>
            <p className="eyebrow">{selected.board}</p><h2>{selected.title}</h2><div className="detail-meta"><span>{selected.date}</span><span>•</span><span>{selected.stage}</span></div>
            <div className="relevance"><p className="eyebrow accent">WHY THIS MATTERS</p><p>{selected.relevance}</p></div>
            <div className="tags-full">{selected.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
            <div className="citations"><p className="eyebrow">SOURCE EVIDENCE</p>{selected.citations.map((citation) => <a key={citation.label} href={citation.url} target="_blank" rel="noreferrer" className="citation"><span className="citation-icon">↗</span><span><strong>{citation.label}</strong><small>{citation.page} · “{citation.excerpt}”</small></span></a>)}</div>
            <button className="outline-button">View original record <span>→</span></button>
          </aside>
        </section>
      </section>
    </main>
  );
}
