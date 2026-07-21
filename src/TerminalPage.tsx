import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

type Node = {
  id: string;
  label: string;
  caption: string;
  group?: string;
  x?: number;
  y?: number;
};
type Link = { source: string; target: string; type: string };
type SearchResult = Node & { sublabel: string };
type Evidence = {
  kind: "doc" | "video";
  title: string;
  snippet: string;
  url: string | null;
  videoId?: string;
  startSeconds?: number;
};
type Connection = {
  type: string;
  direction: "in" | "out";
  neighbor: Node;
  confidence: number | null;
  source: string | null;
};
type Dossier = {
  node: Node & { props: Record<string, unknown> };
  stats: { label: string; value: string; tone?: string }[];
  analytics: Record<string, unknown>;
  connections: Connection[];
  evidence: Evidence[];
  narrative: { summary: string };
  error?: string;
};
type Graph = { nodes: Node[]; links: Link[]; error?: string };
const colors: Record<string, string> = {
  Case: "#ffb347",
  Person: "#53d6c7",
  Organization: "#7ea6ff",
  Parcel: "#ef7c8e",
  ZoningDistrict: "#c68cff",
  Meeting: "#ffdc68",
  Document: "#a0adbd",
};

export default function TerminalPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dossier, setDossier] = useState<Dossier>();
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const timer = useRef<number>();
  // Size the force-graph canvas to its panel; without explicit width/height react-force-graph defaults to the full window and paints over the dossier column.
  const mapRef = useRef<HTMLElement>(null);
  const [mapSize, setMapSize] = useState({ w: 640, h: 520 });
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () =>
      setMapSize({ w: el.clientWidth, h: Math.max(320, el.clientHeight - 40) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const load = (item: Node) => {
    setLoading(true);
    setLoadError("");
    setDossier(undefined);
    setGraph({ nodes: [], links: [] });
    Promise.all([
      fetch(`/api/terminal/entity?id=${encodeURIComponent(item.id)}`).then(
        async (r) => {
          const value = await r.json();
          if (!r.ok || value?.error) throw new Error();
          return value;
        },
      ),
      fetch(
        `/api/terminal/graph?id=${encodeURIComponent(item.id)}&hops=1`,
      ).then(async (r) => {
        const value = await r.json();
        if (!r.ok || value?.error) throw new Error();
        return value;
      }),
    ])
      .then(([entity, map]: [Dossier, Graph]) => {
        setDossier(entity?.node ? entity : undefined);
        setGraph(
          Array.isArray(map?.nodes)
            ? map
            : { nodes: [], links: [], error: "terminal_unavailable" },
        );
      })
      .catch(() => {
        setLoadError(
          "This dossier is unavailable because the live graph could not be read.",
        );
        setGraph({ nodes: [], links: [], error: "terminal_unavailable" });
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearchState("idle");
      return;
    }
    timer.current = window.setTimeout(() => {
      setSearchState("loading");
      fetch(`/api/terminal/search?q=${encodeURIComponent(query)}`)
        .then(async (r) => {
          const value = await r.json();
          if (!r.ok || value?.error) throw new Error();
          return value;
        })
        .then((value: { results?: SearchResult[] }) => {
          setResults(Array.isArray(value.results) ? value.results : []);
          setSearchState("idle");
        })
        .catch(() => {
          setResults([]);
          setSearchState("error");
        });
    }, 180);
    return () => window.clearTimeout(timer.current);
  }, [query]);
  const prediction = dossier?.analytics.prediction as
    | {
        forecast?: string;
        reasoning?: string;
        precedent_case_numbers?: string[];
      }
    | undefined;
  const legend = useMemo(
    () => [...new Set(graph.nodes.map((node) => node.label))],
    [graph.nodes],
  );
  return (
    <main className="terminal-page">
      <header className="tool-heading terminal-intro"><div><p className="eyebrow">ANALYSIS</p><h1>Entity dossiers and power maps</h1><p>Inspect people, organizations, parcels, win rates, precedents, and their source-backed relationships.</p></div><a href="/graph">Open raw graph →</a></header>
      <section className="terminal-workspace">
        <aside className="terminal-search">
          <p className="terminal-kicker">ENTITY LOOKUP</p>
          <label className="terminal-input">
            <span>⌕</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search case, person, parcel…"
            />
          </label>
          <p className="terminal-hint">
            CASE · PERSON · ORGANIZATION · PARCEL · ZONING · MEETING
          </p>
          <div className="terminal-results">
            {searchState === "loading" && (
              <p className="terminal-empty app-skeleton" role="status">
                Searching the live civic graph…
              </p>
            )}
            {searchState === "error" && (
              <p className="terminal-empty" role="alert">
                Search unavailable — the live graph is offline.
              </p>
            )}
            {results.map((item) => (
              <button type="button" key={item.id} onClick={() => load(item)}>
                <b>{item.caption}</b>
                <span>
                  {item.label} · {item.sublabel}
                </span>
              </button>
            ))}
            {query.trim().length >= 2 &&
            searchState === "idle" &&
            !results.length ? (
              <p className="terminal-empty">No matching graph entities.</p>
            ) : null}
          </div>
        </aside>
        <section className="terminal-map" ref={mapRef}>
          <div className="terminal-panel-title">
            <span>POWER MAP / EGO NETWORK</span>
            <small>
              {loading
                ? "QUERYING…"
                : `${graph.nodes.length} NODES · ${graph.links.length} EDGES`}
            </small>
          </div>
          {loading ? (
            <div className="terminal-map-empty app-skeleton" role="status">
              <b>LOADING PUBLIC-RECORD DOSSIER</b>
              <p>Building the graph view and linked evidence…</p>
            </div>
          ) : loadError ? (
            <div className="terminal-map-empty" role="alert">
              <b>GRAPH UNAVAILABLE</b>
              <p>{loadError}</p>
            </div>
          ) : graph.nodes.length ? (
            <ForceGraph2D
              width={mapSize.w}
              height={mapSize.h}
              graphData={graph}
              nodeId="id"
              nodeLabel={(node: object) => (node as Node).caption}
              nodeRelSize={5}
              backgroundColor="#f8f3ea"
              linkColor={() => "rgba(67,87,77,.32)"}
              onNodeClick={(node: object) => load(node as Node)}
              nodeCanvasObject={(
                node: object,
                context: CanvasRenderingContext2D,
                scale: number,
              ) => {
                const item = node as Node;
                const radius = item.id === dossier?.node.id ? 7 : 4;
                context.beginPath();
                context.arc(item.x ?? 0, item.y ?? 0, radius, 0, Math.PI * 2);
                context.fillStyle = colors[item.label] || "#a0adbd";
                context.fill();
                if (scale > 1.2) {
                  context.font = `${11 / scale}px ui-monospace, SFMono-Regular, monospace`;
                  context.fillStyle = "#263b33";
                  context.fillText(
                    item.caption.slice(0, 34),
                    (item.x ?? 0) + radius + 2,
                    (item.y ?? 0) + 3,
                  );
                }
              }}
            />
          ) : (
            <div className="terminal-map-empty">
              <b>SELECT AN ENTITY</b>
              <p>Search the civic knowledge graph to build a live power map.</p>
            </div>
          )}
          <div className="terminal-legend">
            {legend.map((label) => (
              <span key={label}>
                <i style={{ background: colors[label] || "#a0adbd" }} />
                {label}
              </span>
            ))}
          </div>
        </section>
        <aside className="terminal-dossier">
          <p className="terminal-kicker">
            DOSSIER {dossier ? `/ ${dossier.node.label.toUpperCase()}` : ""}
          </p>
          {dossier ? (
            <>
              <h1>{dossier.node.caption}</h1>
              <p className="terminal-id">ID {dossier.node.id}</p>
              <div className="terminal-stats">
                {dossier.stats.map((stat) => (
                  <div key={stat.label}>
                    <span>{stat.label}</span>
                    <b className={stat.tone}>{stat.value}</b>
                  </div>
                ))}
              </div>
              <section className="terminal-brief">
                <p className="terminal-kicker">INTELLIGENCE BRIEF</p>
                <p>{dossier.narrative.summary}</p>
              </section>
              {prediction ? (
                <section className="terminal-prediction">
                  <p className="terminal-kicker">DECISION FORECAST</p>
                  <b>
                    {prediction.forecast ||
                      "Comparable-case forecast unavailable."}
                  </b>
                  <p>{prediction.reasoning}</p>
                  {prediction.precedent_case_numbers?.length ? (
                    <small>
                      PRECEDENTS: {prediction.precedent_case_numbers.join(", ")}
                    </small>
                  ) : null}
                </section>
              ) : null}
              <section className="terminal-connections">
                <p className="terminal-kicker">CONNECTED ENTITIES</p>
                {dossier.connections.slice(0, 12).map((edge, index) => (
                  <button
                    type="button"
                    key={`${edge.type}-${edge.neighbor.id}-${index}`}
                    onClick={() => load(edge.neighbor)}
                  >
                    <span>
                      {edge.direction === "out" ? "→" : "←"} {edge.type}
                    </span>
                    <b>{edge.neighbor.caption}</b>
                  </button>
                ))}
              </section>
            </>
          ) : (
            <div className="terminal-dossier-empty">
              <b>AWAITING TARGET</b>
              <p>
                Stats, outcomes, and connections appear here. Every displayed
                number is graph-computed.
              </p>
            </div>
          )}
        </aside>
      </section>
      <section className="terminal-evidence">
        <div className="terminal-panel-title">
          <span>EVIDENCE DOCK / PRIMARY RECORD RECEIPTS</span>
          <small>{dossier?.evidence.length || 0} RECEIPTS</small>
        </div>
        {dossier?.evidence.length ? (
          <div className="terminal-receipts">
            {dossier.evidence.map((item, index) => (
              <article
                key={`${item.kind}-${item.title}-${index}`}
                className={`terminal-receipt ${item.kind}`}
              >
                <p className="terminal-kicker">
                  {item.kind === "video" ? "VIDEO RECEIPT" : "DOCUMENT RECEIPT"}
                </p>
                <h2>{item.title}</h2>
                <blockquote>“{item.snippet}”</blockquote>
                {item.kind === "video" && item.videoId ? (
                  <iframe
                    title={`Video receipt: ${item.title}`}
                    loading="lazy"
                    src={`https://www.youtube.com/embed/${encodeURIComponent(item.videoId)}?start=${Math.floor(item.startSeconds || 0)}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : null}
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Open public source ↗
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="terminal-no-evidence">
            Select an entity to load its linked documents and timestamped
            meeting receipts.
          </p>
        )}
      </section>
    </main>
  );
}
