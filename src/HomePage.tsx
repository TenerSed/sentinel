import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

type Receipt = {
  kind: string;
  title: string;
  snippet: string;
  url?: string;
  videoId?: string;
  startSeconds?: number;
};
type CaseDetail = {
  case_number: string;
  title: string;
  status: string;
  sections: Record<string, string | string[]>;
  receipts: Receipt[];
  video_receipt?: Receipt;
  meeting?: { board?: string; date?: string };
  vote?: { text?: string };
  prediction?: { precedent_case_numbers?: string[] };
};
type CaseSummary = {
  case_number: string;
  headline: string;
  what_it_is: string;
  status: string;
  address?: string | null;
  applicant?: string | null;
  attorney?: string | null;
  vote?: string | null;
  has_video: boolean;
  has_opposition: boolean;
  lat?: number | null;
  lng?: number | null;
  distance_mi?: number | null;
};
type AddressResults = { addresses: string[] };
type HomeStats = {
  meetings: number;
  cases: number;
  documents: number;
  videos: number;
  decisions: number;
  parcels: number;
  people: number;
  organizations: number;
  transcript_cues: number;
  transcript_characters: number;
  document_characters: number;
};
type CorpusInsights = {
  source_counts: HomeStats;
  themes: { key: string; label: string; count: number }[];
  outcomes: { counts: { label: string; count: number }[]; decided: number; approval_percentage: number };
  case_types: { label: string; count: number }[];
  methodology: string;
};
type Highlight = {
  kind: string;
  headline: string;
  stat: string;
  case_number?: string;
  entity?: string | null;
  href: string;
};
type Health = {
  neo4j: boolean;
  cache: { keys: number; built_at: string | null };
  db: boolean;
};
const example = "RZ-26-1";
const go = (path: string) => {
  window.location.href = path;
};
const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
const status = (s: string, notable = false) =>
  s === "APPROVED"
    ? `${notable ? "🚨 " : "✓ "}Approved`
    : s === "DENIED"
      ? "Denied"
      : s === "WITHDRAWN"
        ? "Withdrawn"
        : s === "TABLED"
          ? "Continued"
          : "Pending";

function HealthBanner({
  health,
  available,
}: {
  health?: Health;
  available: boolean;
}) {
  if (!health || health.neo4j) return null;
  return (
    <div className="resident-data-banner" role="status">
      {available
        ? "Live graph is offline — showing cached public-record data"
        : "Live graph is offline — public-record data is unavailable"}
    </div>
  );
}
function GraphMotif() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dots = Array.from({ length: 36 }, (_, i) => ({
      x: ((i * 47) % 100) / 100,
      y: ((i * 71) % 100) / 100,
      vx: ((i % 5) - 2) * 0.000055,
      vy: ((i % 7) - 3) * 0.000045,
    }));
    let frame = 0;
    const draw = () => {
      const box = element.getBoundingClientRect(),
        ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = box.width * ratio;
      element.height = box.height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const other = dots[j],
            dx = (dot.x - other.x) * box.width,
            dy = (dot.y - other.y) * box.height,
            distance = Math.hypot(dx, dy);
          if (distance < 90) {
            context.strokeStyle = `rgba(31,45,39,${0.12 * (1 - distance / 90)})`;
            context.lineWidth = 0.65;
            context.beginPath();
            context.moveTo(dot.x * box.width, dot.y * box.height);
            context.lineTo(other.x * box.width, other.y * box.height);
            context.stroke();
          }
        }
        context.fillStyle =
          i % 6 === 0 ? "rgba(154,63,43,.42)" : "rgba(31,45,39,.34)";
        context.beginPath();
        context.arc(
          dot.x * box.width,
          dot.y * box.height,
          i % 6 === 0 ? 2 : 1.35,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    };
    const tick = () => {
      for (const dot of dots) {
        dot.x = (dot.x + dot.vx + 1) % 1;
        dot.y = (dot.y + dot.vy + 1) % 1;
      }
      draw();
      frame = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      draw();
      if (!media.matches) frame = requestAnimationFrame(tick);
    };
    update();
    media.addEventListener("change", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return (
    <canvas className="resident-graph-motif" ref={canvas} aria-hidden="true" />
  );
}
function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 850);
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}
function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <article className="resident-receipt">
      <p>PUBLIC RECORD RECEIPT</p>
      <strong>{receipt.title}</strong>
      {receipt.kind === "video" && receipt.videoId ? (
        <iframe
          title={receipt.title}
          src={`https://www.youtube-nocookie.com/embed/${receipt.videoId}?start=${Math.floor(receipt.startSeconds || 0)}`}
          allowFullScreen
        />
      ) : null}
      <blockquote>“{receipt.snippet}”</blockquote>
      {receipt.url && (
        <a href={receipt.url} target="_blank" rel="noreferrer">
          Open source ↗
        </a>
      )}
    </article>
  );
}
function CaseSkeletons({ count }: { count: number }) {
  return (
    <div className="resident-case-skeletons" role="status" aria-label="Loading cases">
      {Array.from({ length: count }, (_, index) => (
        <div className="resident-case-skeleton" key={index} aria-hidden="true">
          <span />
          <strong />
          <p />
          <p />
        </div>
      ))}
    </div>
  );
}
function Detail({ caseNumber }: { caseNumber: string }) {
  const [data, setData] = useState<CaseDetail>();
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health>();
  const [copied, setCopied] = useState("");
  const [draft, setDraft] = useState("");
  const [caseOrder, setCaseOrder] = useState<CaseSummary[]>([]);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    setDraft("");
    void fetch("/api/health")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((nextHealth: Health | undefined) => active && setHealth(nextHealth))
      .catch(() => undefined);
    void fetch(`/api/near/case?case=${encodeURIComponent(caseNumber)}`)
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || x?.error)
          throw new Error(x?.message || "This case could not be loaded.");
        return x;
      })
      .then((x) => {
        if (active) {
          setData(x);
          setDraft(String(x.sections?.drafted_comment || ""));
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "This case could not be loaded.",
          );
          void fetch("/api/health")
            .then((r) => r.json())
            .then((x: Health) => active && setHealth(x))
            .catch(() => undefined);
        }
      });
    void fetch("/api/cases?sort=recent")
      .then((response) => (response.ok ? response.json() : []))
      .then((items: CaseSummary[]) => active && setCaseOrder(items))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [caseNumber]);
  if (!data && !error)
    return (
      <main className="resident-shell">
        <div className="resident-loading" role="status">
          <span className="resident-spinner" />
          Loading the cached public-record case…
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="resident-shell">
        <HealthBanner health={health} available={false} />
        <section className="resident-error" role="alert">
          <h1>Case unavailable</h1>
          <p>{error}</p>
          <a href="/dashboard">Return to the Fishers feed</a>
        </section>
      </main>
    );
  const comment = draft || String(data.sections?.drafted_comment || "");
  const share = `${data.title}\n${data.sections?.did_they_listen || ""}\nVerified from public record · ${window.location.href}`;
  const caseIndex = caseOrder.findIndex(
    (item) => item.case_number === data.case_number,
  );
  const previous = caseIndex > 0 ? caseOrder[caseIndex - 1] : null;
  const next =
    caseIndex >= 0 && caseIndex < caseOrder.length - 1
      ? caseOrder[caseIndex + 1]
      : null;
  return (
    <main className="resident-shell">
      <HealthBanner health={health} available />
      <section className="resident-case-head">
        <a href="/dashboard">← Watch another street</a>
        <p className="resident-kicker">
          SHOULD YOU WORRY? · {data.case_number}
        </p>
        <span className={`resident-status ${data.status}`}>
          {status(data.status)}
        </span>
        <h1>{data.title}</h1>
      </section>
      <section className="resident-expose">
        <p>THE RECORD, IN ONE SCREENSHOT</p>
        <h2>{data.sections?.what_it_is}</h2>
        <strong>{data.sections?.did_they_listen}</strong>
        <small>VERIFIED FROM PUBLIC RECORD · NEVER GUESSED</small>
        <button
          onClick={() =>
            void copy(share).then((ok) =>
              setCopied(ok ? "Copied" : "Copy failed"),
            )
          }
        >
          Share / Copy
        </button>
        {copied && <em>{copied}</em>}
      </section>
      <section className="resident-sections">
        <article>
          <p>01 · WHAT IT IS</p>
          <h2>{data.sections?.what_it_is}</h2>
        </article>
        <article>
          <p>02 · WHO’S BEHIND IT</p>
          <h2>{data.sections?.behind_it}</h2>
          <span>
            Track record is computed from related, deduplicated graph records.
          </span>
        </article>
        <article>
          <p>03 · DID THEY LISTEN?</p>
          <h2>{data.sections?.did_they_listen}</h2>
          {data.vote?.text && <span>Vote tally: {data.vote.text}</span>}
          {data.video_receipt ? (
            <ReceiptCard receipt={data.video_receipt} />
          ) : (
            <span>
              Video receipt was not available; see the document receipts below.
            </span>
          )}
        </article>
        <article>
          <p>04 · THE ODDS</p>
          <h2>{data.sections?.odds}</h2>
          {data.prediction?.precedent_case_numbers?.length ? (
            <span>
              Comparable decisions:{" "}
              {data.prediction.precedent_case_numbers.join(", ")}
            </span>
          ) : null}
        </article>
        <article className="resident-move">
          <p>05 · YOUR MOVE</p>
          <h2>Drafted public comment</h2>
          {data.meeting?.board && (
            <span>
              {data.meeting.board}
              {data.meeting.date ? ` · ${data.meeting.date}` : ""}
            </span>
          )}
          <textarea
            value={comment}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Drafted public comment"
          />
          <button
            onClick={() =>
              void copy(comment).then((ok) =>
                setCopied(ok ? "Comment copied" : "Copy failed"),
              )
            }
          >
            Copy comment
          </button>
          <h3>What to say</h3>
          <ul>
            {(Array.isArray(data.sections?.what_to_say)
              ? data.sections.what_to_say
              : []
            ).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </article>
      </section>
      <section className="resident-receipts">
        <h2>Receipts, not guesses</h2>
        {data.receipts
          .filter((x) => x.kind !== "video")
          .map((x, i) => (
            <ReceiptCard receipt={x} key={`${x.title}-${i}`} />
          ))}
      </section>
      <nav className="resident-case-pagination" aria-label="Browse cases">
        {previous ? (
          <a href={`/case?case=${encodeURIComponent(previous.case_number)}`}>
            <span>← Previous case</span>
            <strong>{previous.headline}</strong>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={`/case?case=${encodeURIComponent(next.case_number)}`}>
            <span>Next case →</span>
            <strong>{next.headline}</strong>
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
function VendorEcosystem() {
  return <section className="universal-vendors"><p className="resident-kicker">WORKS IN ANY CITY</p><h2>Built around the systems local government already uses.</h2><p>Sentinel verifies CivicClerk, Granicus/Legistar, PrimeGov, and NovusAgenda meeting sources; Esri ArcGIS parcel and zoning layers; and public YouTube meeting video.</p><a href="/onboard">Check your city’s official sources →</a></section>;
}

function NoCityLanding() {
  const auth = useAuth();
  const exploreReference = async () => {
    await auth.saveProfile({ city: "Fishers", state: "IN", vendor: "civicclerk", slug: "fishersin", isReference: true, meetingsIngested: 184, sourcesVerified: 3, address: "" });
    window.location.reload();
  };
  return <main className="resident-shell universal-landing"><section className="resident-hero"><GraphMotif /><div className="resident-hero-copy"><p className="resident-kicker">LOCAL CIVIC INTELLIGENCE · ANY CITY</p><h1>The intelligence developers pay lobbyists for — free, for the residents they’re building next to.</h1><p>Choose a city to verify its official meetings, land records, zoning sources, and public video—then see exactly what Sentinel has indexed.</p><div className="universal-hero-actions"><a className="resident-onboard-cta" href="/onboarding">Choose your city</a><button type="button" onClick={() => void exploreReference()}>Explore the reference city</button></div></div></section><section className="universal-empty-proof"><p className="resident-kicker">CITY-SCOPED BY DESIGN</p><h2>No city selected yet.</h2><p>Coverage totals and local cases appear only after you choose a city. Fishers, IN is available as the fully indexed reference implementation.</p></section><VendorEcosystem /></main>;
}

function ShallowCityDashboard() {
  const auth = useAuth();
  const city = auth.selectedCity!;
  const meetings = city.meetingsIngested || 0;
  return <main className="resident-shell shallow-dashboard"><section className="resident-hero"><GraphMotif /><div className="resident-hero-copy"><p className="resident-kicker">{city.city.toUpperCase()}, {city.state} · YOUR CIVIC ALLY</p><h1>The intelligence developers pay lobbyists for — free, for the residents they’re building next to.</h1><p>Official sources are connected for {city.city}. The dashboard grows only as documents, video, parcels, and cases are extracted.</p><div className="resident-hero-actions"><a className="resident-onboard-cta" href="/onboarding">Change city or sources</a></div></div></section><section className="shallow-status" role="status"><strong>{city.city}, {city.state}</strong><span>{city.sourcesVerified ? `Sources verified · ${meetings.toLocaleString()} meetings ingested` : "No sources verified yet"}</span><p>{city.sourcesVerified ? `Sources verified and ${meetings.toLocaleString()} meetings ingested for ${city.city}. ` : ""}Deep extraction (documents, video, graph) is built for the reference city Fishers, IN.</p><a href="/onboarding">Manage city sources</a></section><section className="resident-dashboard shallow-dashboard-grid"><div className="resident-dashboard-head"><div><p className="resident-kicker">{city.city.toUpperCase()} DASHBOARD</p><h2>Your local view</h2></div></div><div className="resident-dashboard-grid"><section><h3>Address &amp; near me</h3><label className="shallow-address">Address in {city.city}<input type="search" disabled placeholder={`Address search pending for ${city.city}`} /></label><p className="app-empty">Parcel-aware near-me results will appear when a verified local parcel layer is indexed.</p></section><section><h3>Recently decided</h3><p className="app-empty">No extracted decisions yet. Sentinel will not substitute Fishers cases.</p></section><section><h3>Currently pending</h3><p className="app-empty">No extracted pending cases yet.</p></section><section><h3>Your tracked cases</h3><p className="app-empty">Tracking opens when this city’s case records are extracted.</p></section></div></section><VendorEcosystem /></main>;
}

function ReferenceHomePage() {
  const auth = useAuth();
  const profileApplied = useRef(false);
  const [path, setPath] = useState(
    window.location.pathname + window.location.search,
  );
  const [address, setAddress] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [nearest, setNearest] = useState<CaseSummary[]>([]);
  const [nearestState, setNearestState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [casesState, setCasesState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [matches, setMatches] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [stats, setStats] = useState<HomeStats>();
  const [statsState, setStatsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightsState, setHighlightsState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [health, setHealth] = useState<Health>();
  const [corpus, setCorpus] = useState<CorpusInsights>();

  useEffect(() => {
    const update = () =>
      setPath(window.location.pathname + window.location.search);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/health")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((x: Health | undefined) => active && setHealth(x))
      .catch(() => undefined);
    void fetch("/api/stats")
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok) throw new Error(x?.message);
        return x;
      })
      .then((x: HomeStats) => {
        if (active) {
          setStats(x);
          setStatsState("ready");
        }
      })
      .catch(() => active && setStatsState("error"));
    void fetch("/api/highlights")
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || !Array.isArray(x)) throw new Error(x?.message);
        return x;
      })
      .then((x: Highlight[]) => {
        if (active) {
          setHighlights(x);
          setHighlightsState("ready");
        }
      })
      .catch(() => active && setHighlightsState("error"));
    void fetch("/api/insights/corpus")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: CorpusInsights) => { if (active) setCorpus(payload); })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const query = address.trim();
    if (query.length < 2) {
      setMatches([]);
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`/api/near/addresses?q=${encodeURIComponent(query)}&limit=8`)
        .then((r) => r.json())
        .then((data: AddressResults) => {
          setMatches(data.addresses || []);
          setOpen(true);
          setActiveMatch(-1);
        })
        .catch(() => {
          setMatches([]);
          setOpen(false);
        });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [address]);
  useEffect(() => {
    let active = true;
    void fetch("/api/cases?sort=recent")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload)) throw new Error();
        return payload as CaseSummary[];
      })
      .then((items) => { if (active) { setCases(items); setCasesState("ready"); } })
      .catch(() => active && setCasesState("error"));
    return () => { active = false; };
  }, []);

  const loadNearest = (residentAddress: string) => {
    setNearest([]);
    setNearestState("loading");
    return fetch(
      `/api/cases?address=${encodeURIComponent(residentAddress)}&sort=distance`,
    )
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || !Array.isArray(x)) throw new Error(x?.message);
        return x;
      })
      .then((items: CaseSummary[]) => {
        setNearest(
          items.filter((item) => item.distance_mi != null).slice(0, 5),
        );
        setNearestState("ready");
      })
      .catch(() => {
        setNearestState("error");
      });
  };
  const selectAddress = (selectedAddress: string) => {
    setAddress(selectedAddress);
    setSelectedAddress(selectedAddress);
    setMatches([]);
    setOpen(false);
    setActiveMatch(-1);
    void loadNearest(selectedAddress);
  };
  useEffect(() => {
    if (profileApplied.current || auth.profileLoading || !auth.profile?.address) return;
    profileApplied.current = true;
    selectAddress(auth.profile.address);
  }, [auth.profile, auth.profileLoading]);
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (open && activeMatch >= 0 && matches[activeMatch])
      selectAddress(matches[activeMatch]);
    else if (address.trim()) {
      setOpen(false);
      setSelectedAddress(address.trim());
      void loadNearest(address.trim());
    }
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setOpen(true);
      setActiveMatch((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setActiveMatch((current) => Math.max(current - 1, 0));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveMatch(-1);
    }
  };
  const caseParam = new URLSearchParams(window.location.search).get("case");
  if (path.startsWith("/case") && caseParam)
    return <Detail caseNumber={caseParam} />;
  const cards = (items: CaseSummary[]) =>
    items.map((item) => (
      <button
        className="resident-case-card"
        key={item.case_number}
        onClick={() => go(`/case?case=${encodeURIComponent(item.case_number)}`)}
      >
        <div className="resident-case-card-top">
          <span className={`resident-status ${item.status}`}>
            {status(item.status)}
          </span>
          <span>{item.case_number}</span>
        </div>
        <h3>{item.headline}</h3>
        <p>{item.what_it_is}</p>
        <dl>
          {item.address && (
            <div>
              <dt>Address</dt>
              <dd>{item.address}</dd>
            </div>
          )}
          {item.applicant && (
            <div>
              <dt>Applicant</dt>
              <dd>{item.applicant}</dd>
            </div>
          )}
          {item.attorney && (
            <div>
              <dt>Attorney</dt>
              <dd>{item.attorney}</dd>
            </div>
          )}
          {item.vote && (
            <div>
              <dt>Vote</dt>
              <dd>{item.vote}</dd>
            </div>
          )}
        </dl>
        <div className="resident-case-badges">
          {item.distance_mi != null && <b>{item.distance_mi} mi away</b>}
          {item.has_video && <b>Video receipt</b>}
          {item.has_opposition && <b>Public opposition</b>}
          <small>Open case →</small>
        </div>
      </button>
    ));
  const hasNeededData = Boolean(stats || highlights.length || cases.length);
  const decided = cases.filter((item) => ["APPROVED", "DENIED", "WITHDRAWN"].includes(item.status)).slice(0, 3);
  const pending = cases.filter((item) => ["PENDING", "TABLED"].includes(item.status)).slice(0, 3);
  const watched = cases.filter((item) => auth.tracked.has(item.case_number)).slice(0, 3);

  return (
    <main className="resident-shell">
      <HealthBanner health={health} available={hasNeededData} />
      <section className="resident-hero">
        <GraphMotif />
        <div className="resident-hero-copy">
          <p className="resident-kicker">FISHERS, IN · FULLY INDEXED REFERENCE CITY</p>
          <h1>
            The intelligence developers pay lobbyists for — free, for the residents they’re building next to.
          </h1>
          <p>
            See what your local government is doing to your neighborhood —
            before it’s decided.
          </p>
          <form onSubmit={search}>
            <label htmlFor="resident-address">Enter your address</label>
            <div className="resident-address-row">
              <div className="resident-combobox">
                <input
                  id="resident-address"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open && matches.length > 0}
                  aria-controls="resident-address-options"
                  aria-activedescendant={
                    activeMatch >= 0
                      ? `resident-address-option-${activeMatch}`
                      : undefined
                  }
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={keys}
                  onFocus={() => matches.length && setOpen(true)}
                  placeholder="Start typing an address in Fishers"
                  autoComplete="off"
                />
                {open && matches.length > 0 && (
                  <ul
                    id="resident-address-options"
                    role="listbox"
                    className="resident-address-options"
                  >
                    {matches.map((match, index) => (
                      <li
                        id={`resident-address-option-${index}`}
                        role="option"
                        aria-selected={index === activeMatch}
                        key={match}
                      >
                        <button
                          type="button"
                          className={index === activeMatch ? "active" : ""}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectAddress(match)}
                        >
                          {match}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button>Watch my street</button>
            </div>
          </form>
          <div className="resident-hero-actions"><a className="resident-onboard-cta" href="/onboarding">Change city</a><a href="/tracker">Browse all cases</a><button className="resident-example" onClick={() => go(`/case?case=${example}`)}>Try a live case <span>Story Cottage rezoning →</span></button></div>
        </div>
      </section>
      {statsState === "loading" && (
        <div className="resident-loading" role="status">
          <span className="resident-spinner" />
          Loading cached coverage totals…
        </div>
      )}
      {statsState === "error" && (
        <p className="resident-inline-error" role="alert">
          Coverage totals are unavailable right now.
        </p>
      )}
      {stats && (
        <><div className="resident-proof-label"><strong>Fishers, IN</strong><span>Fully indexed reference city</span></div><section
          className="resident-proof"
          aria-label="Sentinel public-record coverage"
        >
          <div>
            <strong>
              <Count value={stats.meetings} />
            </strong>
            <span>meetings ingested</span>
          </div>
          <div>
            <strong>
              <Count value={stats.documents} />
            </strong>
            <span>text documents · {stats.document_characters.toLocaleString()} characters</span>
          </div>
          <div>
            <strong>
              <Count value={stats.videos} />
            </strong>
            <span>videos ingested</span>
          </div>
          <div>
            <strong>
              <Count value={stats.transcript_cues} />
            </strong>
            <span>timestamped transcript cues</span>
          </div>
          <div>
            <strong>
              <Count value={stats.parcels} />
            </strong>
            <span>parcels indexed</span>
          </div>
        </section></>
      )}
      {corpus && <section className="resident-corpus" aria-labelledby="corpus-title">
        <div className="resident-corpus-head"><div><p className="resident-kicker">THE COMPLETE PUBLIC RECORD, COUNTED</p><h2 id="corpus-title">We read everything. Here’s what’s inside.</h2></div><p>Computed across {corpus.source_counts.transcript_cues.toLocaleString()} transcript cues and {corpus.source_counts.documents.toLocaleString()} documents.</p></div>
        <div className="resident-corpus-grid">
          <article className="resident-theme-chart"><h3>What Fishers talked about</h3><p>Cues containing each word or listed variant.</p><div>{corpus.themes.map((theme) => <div className="resident-bar-row" key={theme.key}><span>{theme.label}</span><div><i style={{ width: `${(theme.count / Math.max(...corpus.themes.map((item) => item.count), 1)) * 100}%` }} /></div><strong>{theme.count.toLocaleString()}</strong></div>)}</div></article>
          <div className="resident-corpus-side">
            <article className="resident-outcomes"><h3>How this board rules</h3><strong>{corpus.outcomes.approval_percentage}%</strong><p>of {corpus.outcomes.decided} cases with a recorded decision/outcome were approved.</p><div className="resident-stacked" aria-label="Case outcomes">{corpus.outcomes.counts.filter((item) => item.count > 0).map((item) => <i key={item.label} className={item.label.toLowerCase()} style={{ width: `${(item.count / corpus.outcomes.decided) * 100}%` }} title={`${item.label}: ${item.count}`} />)}</div><ul>{corpus.outcomes.counts.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.count}</strong></li>)}</ul></article>
            <article className="resident-case-types"><h3>Where it’s happening</h3><p>Land-use cases by case type.</p><div>{corpus.case_types.map((item) => <div className="resident-bar-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${(item.count / Math.max(...corpus.case_types.map((type) => type.count), 1)) * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div></article>
          </div>
        </div>
        <small>{corpus.methodology}</small>
      </section>}
      <section className="resident-capabilities">
        <p className="resident-kicker">WHAT YOU CAN DO HERE</p>
        <div>
          <a href="/tracker"><span>01</span><h2>Track cases affecting your street</h2><p>Filter the complete case record, sort by distance, and save a watchlist in this browser.</p></a>
          <a href="/terminal"><span>02</span><h2>See who’s behind them</h2><p>Open entity dossiers, compare win rates, and inspect how the board has ruled.</p></a>
          <a href="/case?case=RZ-26-1"><span>03</span><h2>Get the receipts</h2><p>Read original documents and jump to timestamped public-meeting video.</p></a>
        </div>
      </section>
      <section className="resident-dashboard">
        <div className="resident-dashboard-head"><div><p className="resident-kicker">LIVE CACHED DASHBOARD</p><h2>Cases at a glance</h2></div><a href="/tracker">Open full tracker →</a></div>
        {casesState === "loading" && <CaseSkeletons count={3} />}
        {casesState === "error" && <p className="resident-inline-error" role="alert">The cached case dashboard could not be loaded.</p>}
        {casesState === "ready" && <div className="resident-dashboard-grid">
          <section><h3>Recently decided</h3>{decided.length ? cards(decided) : <p className="app-empty">No decided cases are present in this snapshot.</p>}</section>
          <section><h3>Currently pending</h3>{pending.length ? cards(pending) : <p className="app-empty">No pending cases are present in this snapshot.</p>}</section>
          <section><h3>Your tracked cases</h3>{watched.length ? cards(watched) : <div className="app-empty"><strong>Your watchlist is empty.</strong><p>Star a case in Tracker to keep it here.</p><a href="/tracker">Choose cases to track →</a></div>}</section>
        </div>}
      </section>
      <section className="resident-highlights">
        <p className="resident-kicker">WHAT THE RECORD REVEALED</p>
        <h2>Patterns no agenda headline will tell you.</h2>
        {highlightsState === "loading" && (
          <p className="resident-highlight-loading">
            <span className="resident-spinner" /> Loading cached record
            highlights…
          </p>
        )}
        {highlightsState === "error" && (
          <p className="resident-inline-error" role="alert">
            Public-record highlights are unavailable right now.
          </p>
        )}
        {highlightsState === "ready" && highlights.length === 0 && (
          <p>No evidence-backed highlights are present in this snapshot.</p>
        )}
        {highlights.length > 0 && (
          <div className="resident-highlight-list">
            {highlights.map((item) => (
              <a
                className="resident-highlight-card"
                href={item.href}
                key={`${item.kind}-${item.case_number}`}
              >
                <span>{item.kind.split("_").join(" · ")}</span>
                <h3>{item.headline}</h3>
                <p>{item.stat}</p>
                <b>See the receipt →</b>
              </a>
            ))}
          </div>
        )}
      </section>
      {selectedAddress && (
        <section className="resident-nearest">
          <p className="resident-kicker">NEAREST TO {selectedAddress}</p>
          <h2>Cases closest to your address</h2>
          {nearestState === "loading" && <CaseSkeletons count={3} />}
          {nearestState === "error" && (
            <p className="resident-inline-error" role="alert">
              We couldn’t locate that parcel. Choose a suggested Fishers
              address; every case remains available below.
            </p>
          )}
          {nearestState === "ready" && nearest.length > 0 && (
            <>
              {(nearest[0].distance_mi || 0) > 2 && (
                <p className="resident-distance-note">
                  No cached land-use case is within 2 miles. Here are the
                  closest records instead.
                </p>
              )}
              {cards(nearest)}
              <a className="resident-near-link" href={`/tracker?q=${encodeURIComponent(`near ${selectedAddress}`)}`}>Open Tracker near {selectedAddress} →</a>
            </>
          )}
          {nearestState === "ready" && nearest.length === 0 && (
            <p className="resident-distance-note">
              This address matched, but its closest cases do not have mapped
              parcel coordinates. Browse every record below.
            </p>
          )}
        </section>
      )}
      <section className="resident-why">
        <p className="resident-kicker">WHY NOT JUST ASK CHATGPT?</p>
        <h2>Public records beat plausible answers.</h2>
        <ul>
          <li>General chatbots do not carry this complete local record or its source locators.</li>
          <li>Sentinel’s displayed claims resolve to ingested documents or timestamped meeting video.</li>
          <li>All views are served from the cached record—no model call sits in the request path.</li>
        </ul>
      </section>
      <VendorEcosystem />
      <footer className="resident-footer">
        Fishers, IN — fully indexed reference city. Built from Fishers CivicClerk minutes &amp; agenda packets, City of
        Fishers public-meeting videos, and Hamilton County parcel records —
        every claim cited to its source.
      </footer>
    </main>
  );
}

export default function HomePage() {
  const auth = useAuth();
  if (auth.profileLoading) return <main className="resident-shell"><div className="resident-loading" role="status"><span className="resident-spinner" />Loading your selected city…</div></main>;
  if (!auth.selectedCity) return <NoCityLanding />;
  if (!auth.selectedCity.isReference) return <ShallowCityDashboard />;
  return <ReferenceHomePage />;
}
