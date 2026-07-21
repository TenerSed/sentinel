import { FormEvent, useEffect, useState } from "react";

type Evidence = { case_number: string; title?: string; url?: string | null };
type Finding = {
  type: string;
  headline: string;
  why: string;
  stat: string;
  case_numbers: string[];
  entities: string[];
  evidence: Evidence[];
};
type Prediction = {
  forecast?: string;
  reasoning?: string;
  precedent_case_numbers?: string[];
  approval_rate?: number;
  approved?: number;
  total?: number;
  evidence?: Evidence[];
  error?: string;
};
type Near = {
  parcel?: { local_address?: string };
  cases?: { case_number: string; status?: string; title?: string }[];
  briefing?: string;
  draft_comment?: string;
  evidence?: Evidence[];
  error?: string;
};
const chips = (evidence: Evidence[]) => (
  <div className="insight-chips">
    {evidence.map((item) =>
      item.url ? (
        <a
          key={`${item.case_number}-${item.url}`}
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          {item.case_number} · source ↗
        </a>
      ) : (
        <span key={item.case_number}>{item.case_number}</span>
      ),
    )}
  </div>
);

export default function InvestigatePage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [caseNumber, setCaseNumber] = useState("PUD-25-14");
  const [prediction, setPrediction] = useState<Prediction>();
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [address, setAddress] = useState("");
  const [near, setNear] = useState<Near>();
  const [nearLoading, setNearLoading] = useState(false);
  useEffect(() => {
    fetch("/api/insights/findings")
      .then((r) => r.json())
      .then((v: unknown) =>
        setFindings(
          Array.isArray((v as { findings?: unknown })?.findings)
            ? (v as { findings: Finding[] }).findings
            : [],
        ),
      )
      .catch(() => setFindings([]))
      .finally(() => setLoading(false));
  }, []);
  const runPrediction = (event: FormEvent) => {
    event.preventDefault();
    setPrediction(undefined);
    setPredictionLoading(true);
    fetch(`/api/insights/predict?case=${encodeURIComponent(caseNumber)}`)
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || x?.error) throw new Error();
        return x;
      })
      .then((v: Prediction) => setPrediction(v))
      .catch(() =>
        setPrediction({
          error:
            "Prediction unavailable because the live graph could not be read.",
        }),
      )
      .finally(() => setPredictionLoading(false));
  };
  const runNear = (event: FormEvent) => {
    event.preventDefault();
    setNear(undefined);
    setNearLoading(true);
    fetch(`/api/insights/near?address=${encodeURIComponent(address)}`)
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || x?.error) throw new Error();
        return x;
      })
      .then((v: Near) => setNear(v))
      .catch(() =>
        setNear({
          error:
            "Near-me briefing unavailable because the live graph could not be read.",
        }),
      )
      .finally(() => setNearLoading(false));
  };
  return (
    <main className="investigate-page">
      <header className="graph-header">
        <div>
          <p className="eyebrow">SENTINEL / INTELLIGENCE ENGINE</p>
          <h1>Connections no one has time to assemble</h1>
          <p>
            Cross-document patterns are computed from the civic graph; narrative
            is grounded in those facts and linked evidence.
          </p>
        </div>
        <a className="graph-back" href="/">
          ← Back to updates
        </a>
      </header>
      <section className="findings-panel">
        <div className="panel-heading">
          <p className="eyebrow">FINDINGS FEED</p>
          <h2>What the graph surfaces</h2>
          <p>
            {loading
              ? "Computing graph patterns…"
              : `${findings.length} evidence-backed patterns`}
          </p>
        </div>
        <div className="findings-list">
          {findings.map((finding) => (
            <article
              className="finding-card"
              key={`${finding.type}-${finding.headline}`}
            >
              <p className="eyebrow">{finding.type.replace(/_/g, " ")}</p>
              <h2>{finding.headline}</h2>
              <p className="finding-stat">{finding.stat}</p>
              <p>{finding.why}</p>
              {chips(finding.evidence)}
            </article>
          ))}
          {!loading && !findings.length && (
            <p className="graph-empty">
              Findings are temporarily unavailable. The underlying civic graph
              remains intact.
            </p>
          )}
        </div>
      </section>
      <section className="investigate-grid">
        <section className="investigate-card">
          <p className="eyebrow">PRECEDENT PREDICTION</p>
          <h2>Will it pass?</h2>
          <form onSubmit={runPrediction}>
            <label htmlFor="case-number">Case number</label>
            <input
              id="case-number"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
            />
            <button type="submit" disabled={predictionLoading}>
              {predictionLoading ? "Comparing…" : "Compare precedents"}
            </button>
          </form>
          {predictionLoading && (
            <p className="map-load-message" role="status">
              <span className="resident-spinner" /> Comparing public-record
              precedents…
            </p>
          )}
          {prediction && (
            <div
              className="insight-result"
              role={prediction.error ? "alert" : undefined}
            >
              <p className="finding-stat">
                {prediction.forecast ||
                  (prediction.total != null
                    ? `${prediction.approval_rate}% approval rate (${prediction.approved}/${prediction.total})`
                    : prediction.error)}
              </p>
              <p>{prediction.reasoning}</p>
              {prediction.precedent_case_numbers?.length ? (
                <p>
                  Precedents: {prediction.precedent_case_numbers.join(", ")}
                </p>
              ) : null}
              {chips(prediction.evidence || [])}
            </div>
          )}
        </section>
        <section className="investigate-card">
          <p className="eyebrow">PERSONAL BRIEFING</p>
          <h2>What’s near me?</h2>
          <form onSubmit={runNear}>
            <label htmlFor="near-address">Fishers address</label>
            <input
              id="near-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 1 Municipal Drive"
            />
            <button type="submit" disabled={nearLoading}>
              {nearLoading ? "Building briefing…" : "Brief me"}
            </button>
          </form>
          {nearLoading && (
            <p className="map-load-message" role="status">
              <span className="resident-spinner" /> Matching the parcel to the
              public record…
            </p>
          )}
          {near && (
            <div
              className="insight-result"
              role={near.error ? "alert" : undefined}
            >
              <p>{near.briefing || near.error}</p>
              {near.draft_comment && (
                <>
                  <p className="eyebrow">DRAFTED PUBLIC COMMENT</p>
                  <blockquote>{near.draft_comment}</blockquote>
                </>
              )}
              {chips(near.evidence || [])}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
