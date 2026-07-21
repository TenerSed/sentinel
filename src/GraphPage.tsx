import { useEffect, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

type Layer = "structured" | "open" | "both";
type GraphNode = { id: string; label: string; caption: string; group: string; x?: number; y?: number };
type GraphLink = { source: string; target: string; type: string };
type GraphPayload = { nodes: GraphNode[]; links: GraphLink[]; counts?: { nodes: number; links: number }; error?: string };
type Evidence = { docType: "document" | "video"; docTitle: string; snippet: string; citationUrl: string | null };
type ExpandedEdge = { id: string; type: string; direction: "out" | "in"; neighbor: GraphNode; source: string | null; source_id: string | null; confidence: number | null; extraProps: Record<string, unknown>; evidence: Evidence | null };
type Expansion = { node: GraphNode & { props: Record<string, unknown> }; edges: ExpandedEdge[]; error?: string };
const palette = ["#667f20", "#53728b", "#a65f45", "#8566a3", "#b77c23", "#357a71", "#7d5a50", "#5c7c4d"];

export default function GraphPage() {
  const [layer, setLayer] = useState<Layer>("structured");
  const [limit, setLimit] = useState(250);
  const [data, setData] = useState<GraphPayload>({ nodes: [], links: [] });
  const [selected, setSelected] = useState<GraphNode>();
  const [expansion, setExpansion] = useState<Expansion>();
  const [expanding, setExpanding] = useState(false);
  const [canvasCap, setCanvasCap] = useState(false);
  const [loading, setLoading] = useState(true);
  const colors = useMemo(() => new Map<string, string>(), []);
  const color = (group: string) => { if (!colors.has(group)) colors.set(group, palette[colors.size % palette.length]); return colors.get(group)!; };

  useEffect(() => {
    let active = true;
    setLoading(true); setSelected(undefined); setExpansion(undefined); setCanvasCap(false);
    fetch(`/api/graph?layer=${layer}&limit=${limit}`).then((response) => response.json()).then((value: unknown) => {
      if (!active || !value || typeof value !== "object") return;
      const payload = value as GraphPayload;
      setData(Array.isArray(payload.nodes) && Array.isArray(payload.links) ? payload : { nodes: [], links: [], error: "neo4j_unavailable" });
    }).catch(() => active && setData({ nodes: [], links: [], error: "neo4j_unavailable" })).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [layer, limit]);

  const expand = (node: GraphNode) => {
    setSelected(node); setExpansion(undefined); setExpanding(true);
    fetch(`/api/graph/expand?id=${encodeURIComponent(node.id)}`).then((response) => response.json()).then((value: unknown) => {
      const result = value as Expansion;
      if (!result?.node || !Array.isArray(result.edges)) return;
      setExpansion(result);
      setData((current) => {
        const nodes = [...current.nodes]; const known = new Set(nodes.map((item) => item.id)); const links = [...current.links]; const knownLinks = new Set(links.map((item) => `${item.source}:${item.type}:${item.target}`)); let capped = false;
        for (const edge of result.edges) {
          if (!known.has(edge.neighbor.id)) { if (nodes.length >= 400) { capped = true; continue; } nodes.push(edge.neighbor); known.add(edge.neighbor.id); }
          const source = edge.direction === "out" ? node.id : edge.neighbor.id, target = edge.direction === "out" ? edge.neighbor.id : node.id, key = `${source}:${edge.type}:${target}`;
          if (!knownLinks.has(key) && known.has(source) && known.has(target)) { links.push({ source, target, type: edge.type }); knownLinks.add(key); }
        }
        if (capped) setCanvasCap(true);
        return { ...current, nodes, links, counts: { nodes: nodes.length, links: links.length } };
      });
    }).catch(() => setExpansion(undefined)).finally(() => setExpanding(false));
  };

  const legend = [...new Set(data.nodes.map((node) => node.group))].sort();
  return <main className="graph-page">
    <header className="tool-heading graph-header"><div><p className="eyebrow">UNDER THE HOOD / KNOWLEDGE GRAPH</p><h1>Fishers civic connections</h1><p>The structured layer contains official cases, meetings, parcels, and parties; the open layer contains source-grounded concepts extracted offline.</p></div><a href="/terminal">Open Analysis →</a></header>
    <section className="graph-controls" aria-label="Graph controls"><label>Layer<select value={layer} onChange={(event) => setLayer(event.target.value as Layer)}><option value="structured">Structured</option><option value="open">Open concepts</option><option value="both">Both layers</option></select></label><label>Node cap<select value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={100}>100</option><option value={250}>250</option><option value={400}>400</option><option value={600}>600</option></select></label><p>{loading ? "Loading graph…" : `${data.counts?.nodes ?? 0} nodes · ${data.counts?.links ?? 0} links`}</p></section>
    {canvasCap && <p className="graph-cap" role="status">Canvas expansion is capped at 400 nodes. Choose a smaller initial slice to explore more neighbors.</p>}
    {data.error === "neo4j_unavailable" ? <section className="graph-message"><h2>Graph temporarily unavailable</h2><p>The knowledge graph could not be loaded. The cached Tracker and Map remain available.</p></section> : <section className="graph-layout"><div className="graph-canvas" aria-label="Interactive civic knowledge graph">{loading ? <div className="graph-loading app-skeleton" role="status">Loading cached graph layers…</div> : data.nodes.length ? <ForceGraph2D graphData={{ nodes: data.nodes, links: data.links }} nodeId="id" nodeLabel={(node: object) => (node as GraphNode).caption} nodeColor={(node: object) => color((node as GraphNode).group)} nodeRelSize={5} linkColor={() => "#b8c4b8"} linkDirectionalParticles={0} onNodeClick={(node: object) => expand(node as GraphNode)} nodeCanvasObject={(node: object, context: CanvasRenderingContext2D, scale: number) => { const item = node as GraphNode; const size = 5; context.beginPath(); context.arc(item.x ?? 0, item.y ?? 0, size, 0, 2 * Math.PI); context.fillStyle = color(item.group); context.fill(); if (scale > 1.25) { context.font = `${12 / scale}px DM Sans`; context.fillStyle = "#26332d"; context.fillText(item.caption.slice(0, 42), (item.x ?? 0) + size + 2 / scale, (item.y ?? 0) + 3 / scale); } }} /> : <p className="graph-empty">No relationships matched this layer yet.</p>}</div><aside className="graph-sidebar"><section><p className="eyebrow">LEGEND</p><div className="graph-legend">{legend.map((group) => <span key={group}><i style={{ background: color(group) }} />{group}</span>)}</div></section><section className="graph-selection"><p className="eyebrow">NODE DETAILS</p>{selected ? <><h2>{expansion?.node.caption ?? selected.caption}</h2><p><strong>Type</strong> {expansion?.node.label ?? selected.label}</p><p><strong>Graph ID</strong> <code>{selected.id}</code></p>{expanding ? <p>Finding grounded connections…</p> : expansion ? <div className="graph-edges">{expansion.edges.map((edge) => <article key={edge.id} className="graph-edge"><p className="graph-edge-title">{edge.direction === "out" ? "→" : "←"} <strong>{edge.type}</strong> {edge.neighbor.caption}</p><p><strong>{edge.neighbor.label}</strong>{edge.confidence != null ? ` · confidence ${edge.confidence}` : ""}</p>{Object.keys(edge.extraProps).length ? <p>{Object.entries(edge.extraProps).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p> : null}{edge.evidence ? <div className="graph-why"><p className="eyebrow">WHY THIS CONNECTION</p><p><strong>{edge.evidence.docTitle}</strong></p><blockquote>“{edge.evidence.snippet}”</blockquote>{edge.evidence.citationUrl ? <a href={edge.evidence.citationUrl} target="_blank" rel="noreferrer">Open cited source ↗</a> : null}</div> : <p className="graph-no-evidence">No source text was available for this relationship.</p>}</article>)}</div> : <p>Connection details failed to load.</p>}</> : <p>Select a node to inspect its connections and evidence.</p>}</section></aside></section>}
  </main>;
}
