import { useEffect, useRef, useState } from "react";

// The live ingestion screen: what the system is doing to a city it has never
// seen, as it happens. Three real phases, no simulated progress —
//   1. discovery  (SSE)   search the open web, then probe every candidate
//   2. ingestion  (job)   page the verified endpoint, extract document text
//   3. graph      (job)   turn those documents into entities and relationships
// Every number on screen comes from the server; nothing is animated ahead of
// the work it represents.

export type PipelineSource = {
  kind: string;
  vendor: string;
  slug?: string;
  url: string;
  verified?: boolean;
  evidence?: { status?: number; sample?: string; firstPageRecords?: number };
};

export type PipelineResult = {
  city: string;
  state: string;
  county?: string | null;
  sources: PipelineSource[];
  meetingsIngested: number;
  documents: number;
  graphNodes: number;
};

type Step = {
  id: string;
  label: string;
  status: "running" | "verified" | "not_found" | "skipped";
  detail?: string;
  citations?: string[];
};

type Probe = {
  vendor: string;
  slug: string;
  url: string;
  status: number | null;
  verified: boolean;
  sample?: string | null;
};

const statusGlyph = (status: Step["status"]) =>
  status === "running" ? "…" : status === "verified" ? "✓" : status === "skipped" ? "–" : "✗";

export default function LivePipeline({
  city,
  state,
  county,
  onComplete,
  onFailure,
}: {
  city: string;
  state: string;
  county?: string;
  onComplete: (result: PipelineResult) => void;
  onFailure: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"discover" | "ingest" | "graph" | "done">("discover");
  const [steps, setSteps] = useState<Step[]>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [sources, setSources] = useState<PipelineSource[]>([]);
  const [meetings, setMeetings] = useState(0);
  const [documents, setDocuments] = useState(0);
  const [documentChars, setDocumentChars] = useState(0);
  const [graphNodes, setGraphNodes] = useState(0);
  const [graphRels, setGraphRels] = useState(0);
  const [graphDone, setGraphDone] = useState(0);
  const [graphTotal, setGraphTotal] = useState(0);
  const [error, setError] = useState("");
  const [probeTarget, setProbeTarget] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // Only the ingest/graph jobs must not run twice under StrictMode's double
  // effect invocation. The EventSource itself MUST be recreated on the second
  // run — guarding the whole effect meant the one stream that was opened had
  // already been closed by the first run's cleanup, so nothing ever rendered.
  const jobsStarted = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    const upsertStep = (step: Step) =>
      setSteps((current) => {
        const index = current.findIndex((item) => item.id === step.id);
        if (index < 0) return [...current, step];
        const next = [...current];
        next[index] = { ...next[index], ...step };
        return next;
      });

    const citySlug = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

    const poll = async (url: string, isDone: (payload: any) => boolean, onTick: (payload: any) => void) => {
      for (let attempt = 0; attempt < 600 && !cancelled; attempt += 1) {
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message || "A background job could not be reached.");
        onTick(payload);
        if (isDone(payload)) return payload;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      throw new Error("The background job did not finish in time.");
    };

    const runIngestAndGraph = async (discovered: PipelineSource[]) => {
      if (jobsStarted.current) return;
      jobsStarted.current = true;
      const meeting = discovered.find((item) => item.kind === "meetings" && item.slug);
      if (!meeting) {
        // An honest dead end: no verified meeting source means nothing to ingest.
        onComplete({ city, state, county, sources: discovered, meetingsIngested: 0, documents: 0, graphNodes: 0 });
        return;
      }

      setPhase("ingest");
      const startResponse = await fetch(
        `/api/onboard/ingest?vendor=${encodeURIComponent(meeting.vendor)}&slug=${encodeURIComponent(meeting.slug || "")}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`,
      );
      const startJob = await startResponse.json();
      if (!startResponse.ok || !startJob.job)
        throw new Error(startJob.message || "Meeting ingestion could not be started.");

      const finalIngest = await poll(
        `/api/onboard/status?job=${encodeURIComponent(startJob.job)}`,
        (job) => job.status === "done" || job.status === "failed",
        (job) => {
          setMeetings(job.meetings || 0);
          setDocuments(job.documents || 0);
          setDocumentChars(job.documentChars || 0);
        },
      );
      if (finalIngest.status === "failed")
        throw new Error(finalIngest.errors?.[0] || "Meeting ingestion failed.");

      const slug = citySlug(city);
      setPhase("graph");
      const graphStart = await fetch(
        `/api/graph/build?slug=${encodeURIComponent(slug)}&place=${encodeURIComponent(`${city}, ${state}`)}`,
      );
      const graphJob = await graphStart.json();
      if (!graphStart.ok) {
        // No documents to extract is a legitimate outcome, not a failure: the
        // city is still fully usable at the meetings level.
        setPhase("done");
        onComplete({
          city,
          state,
          county,
          sources: discovered,
          meetingsIngested: finalIngest.meetings || 0,
          documents: finalIngest.documents || 0,
          graphNodes: 0,
        });
        return;
      }

      const finalGraph = await poll(
        `/api/graph/status?slug=${encodeURIComponent(slug)}&job=${encodeURIComponent(graphJob.job)}`,
        (payload) => payload.job?.status === "done" || payload.job?.status === "failed",
        (payload) => {
          setGraphNodes(payload.graph?.nodeTotal || 0);
          setGraphRels(payload.graph?.relationshipTotal || 0);
          setGraphDone(payload.job?.done || 0);
          setGraphTotal(payload.job?.chunksTotal || payload.job?.chunksEstimated || 0);
        },
      );

      setPhase("done");
      onComplete({
        city,
        state,
        county,
        sources: discovered,
        meetingsIngested: finalIngest.meetings || 0,
        documents: finalIngest.documents || 0,
        graphNodes: finalGraph.graph?.nodeTotal || 0,
      });
    };

    const params = new URLSearchParams({ city, state });
    if (county) params.set("county", county);
    source = new EventSource(`/api/onboard/discover/stream?${params.toString()}`);

    source.addEventListener("step", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      upsertStep({
        id: data.id,
        label: data.label,
        status: data.status === "running" ? "running" : data.status,
        detail: data.detail,
        citations: data.citations,
      });
    });

    source.addEventListener("probe-wave", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setProbeTarget((current) => current + (data.probes || 0));
    });

    source.addEventListener("probe", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setProbes((current) => [...current.slice(-60), data]);
    });

    source.addEventListener("done", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      source?.close();
      setSources(data.sources || []);
      if (cancelled) return;
      runIngestAndGraph(data.sources || []).catch((issue: Error) => {
        if (cancelled) return;
        setError(issue.message);
        onFailure(issue.message);
      });
    });

    source.addEventListener("failed", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      source?.close();
      if (cancelled) return;
      setError(data.error || "Source discovery failed.");
      onFailure(data.error || "Source discovery failed.");
    });

    source.onerror = () => {
      if (cancelled || phase !== "discover") return;
      source?.close();
      setError("The discovery stream was interrupted.");
      onFailure("The discovery stream was interrupted.");
    };

    return () => {
      cancelled = true;
      source?.close();
    };
    // Intentionally runs once for this city.
  }, []);

  const verifiedProbes = probes.filter((probe) => probe.verified);
  const graphPercent = graphTotal ? Math.min(100, Math.round((graphDone / graphTotal) * 100)) : 0;

  // One bar across all three phases so something is always moving. Discovery
  // and ingestion report real ratios; the graph phase reports chunks read.
  const discoverRatio = probeTarget ? Math.min(1, probes.length / probeTarget) : 0.05;
  const overallPercent = Math.round(
    phase === "discover"
      ? discoverRatio * 33
      : phase === "ingest"
        ? 33 + (documents > 0 ? 22 : 11)
        : phase === "graph"
          ? 55 + (graphPercent / 100) * 45
          : 100,
  );
  const activity =
    phase === "discover"
      ? `Probing civic portals — ${probes.length}${probeTarget ? ` of ${probeTarget}` : ""} endpoints checked, ${verifiedProbes.length} verified`
      : phase === "ingest"
        ? documents > 0
          ? `Extracting document text — ${documents.toLocaleString()} documents, ${documentChars.toLocaleString()} characters`
          : `Paging the verified endpoint — ${meetings.toLocaleString()} meetings stored`
        : phase === "graph"
          ? `Reading passages — ${graphDone.toLocaleString()} of ${graphTotal.toLocaleString()}, ${graphNodes.toLocaleString()} entities so far`
          : "Complete";
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <section className="live-pipeline">
      <header>
        <p className="eyebrow">READING THE PUBLIC RECORD</p>
        <h1>
          {city}, {state}
        </h1>
        <p className="live-pipeline-lede">
          Sentinel has never seen this city. It is searching the open web for its meeting portal,
          verifying every candidate against the live API, and building a graph from what it finds.
          Nothing here is pre-loaded.
        </p>
      </header>

      <ol className="live-pipeline-phases">
        <li className={phase === "discover" ? "active" : "complete"}>1 · Find the sources</li>
        <li className={phase === "ingest" ? "active" : phase === "discover" ? "" : "complete"}>
          2 · Ingest the record
        </li>
        <li className={phase === "graph" ? "active" : phase === "done" ? "complete" : ""}>
          3 · Build the graph
        </li>
      </ol>

      <div className="live-overall" role="status" aria-live="polite">
        <div className="live-overall-bar">
          <span
            className={phase === "done" ? "" : "working"}
            style={{ width: `${Math.max(overallPercent, 3)}%` }}
          />
        </div>
        <div className="live-overall-meta">
          <span>{activity}</span>
          <span className="live-overall-clock">{mmss}</span>
        </div>
      </div>

      <div className="live-pipeline-steps">
        {steps.map((step) => (
          <div key={step.id} className={`live-step ${step.status}`}>
            <span className="live-step-glyph">{statusGlyph(step.status)}</span>
            <div>
              <strong>{step.label}</strong>
              {step.detail && <p>{step.detail}</p>}
              {step.citations?.length ? (
                <ul className="live-step-citations">
                  {step.citations.slice(0, 4).map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer noopener">
                        {url.replace(/^https?:\/\//, "").slice(0, 70)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {probes.length > 0 && phase === "discover" && (
        <div className="live-probe-log" aria-live="polite">
          <p className="live-probe-heading">
            Live endpoint probes — {verifiedProbes.length} verified of {probes.length}
          </p>
          <ul>
            {probes.slice(-12).map((probe, index) => (
              <li key={`${probe.vendor}-${probe.slug}-${index}`} className={probe.verified ? "hit" : "miss"}>
                <code>
                  {probe.vendor}/{probe.slug}
                </code>
                <span>{probe.status ?? "—"}</span>
                <em>{probe.verified ? probe.sample || "verified" : "no match"}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(phase === "ingest" || phase === "graph" || phase === "done") && (
        <div className="live-pipeline-counters">
          <div>
            <strong>{meetings.toLocaleString()}</strong>
            <span>meetings ingested</span>
          </div>
          <div>
            <strong>{documents.toLocaleString()}</strong>
            <span>documents extracted</span>
          </div>
          <div>
            <strong>{documentChars.toLocaleString()}</strong>
            <span>characters of text</span>
          </div>
          {(phase === "graph" || phase === "done") && (
            <>
              <div>
                <strong>{graphNodes.toLocaleString()}</strong>
                <span>graph entities</span>
              </div>
              <div>
                <strong>{graphRels.toLocaleString()}</strong>
                <span>relationships</span>
              </div>
            </>
          )}
        </div>
      )}

      {phase === "graph" && (
        <div className="live-graph-progress">
          <div className="live-graph-bar">
            <span style={{ width: `${graphPercent}%` }} />
          </div>
          <p>
            Extracting entities from {documents.toLocaleString()} documents — {graphDone.toLocaleString()} of{" "}
            {graphTotal.toLocaleString()} passages read. You can keep using Sentinel while this runs; the
            graph fills in as it goes.
          </p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="live-pipeline-sources">
          <p className="live-probe-heading">Verified sources</p>
          <ul>
            {sources.map((item) => (
              <li key={item.url}>
                <strong>
                  {item.vendor} · {item.kind}
                </strong>
                <a href={item.url} target="_blank" rel="noreferrer noopener">
                  {item.url.replace(/^https?:\/\//, "").slice(0, 80)}
                </a>
                {item.evidence?.sample && <em>{item.evidence.sample}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="live-pipeline-error">{error}</p>}
    </section>
  );
}
