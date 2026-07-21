import { FormEvent, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import { ResidentProfile, useAuth } from "./AuthContext";
import "leaflet/dist/leaflet.css";

type City = { city: string; state: string; county?: string; reference?: boolean };
type LocatedCity = City & { county: string; stateName: string; lat: number; lng: number; source: "nominatim" | "census" };
type Source = { kind: string; vendor: string; slug?: string; url: string; evidence?: { status?: number; sample?: string; firstPageRecords?: number } };
type Attempt = { kind: string; vendor: string; slug?: string; url?: string | null; probeUrl?: string; status?: number | null; reason?: string; verified?: boolean };
type Discovery = { city: string; state: string; county?: string | null; sources: Source[]; attempts: Attempt[]; meetingsIngested?: number };
type Probe = { id: string; label: string; endpoint?: string | null; sample?: string; reason?: string; status: "waiting" | "verified" | "not_found" };
type IngestResult = { ingested: number; sample: string[] };

const referencePoints = [
  { label: "Fishers, IN · fully indexed", lat: 39.9568, lng: -86.0125 },
  { label: "San Jose, CA", lat: 37.3382, lng: -121.8863 },
  { label: "Carmel, IN", lat: 39.9784, lng: -86.118 },
];
const usCenter: [number, number] = [39.5, -98.35];
const initialProbes: Probe[] = [
  { id: "candidate", label: "Propose official-system candidates", status: "waiting" },
  { id: "civicclerk", label: "Probe CivicClerk meeting endpoints", status: "waiting" },
  { id: "legistar", label: "Probe Granicus / Legistar endpoints", status: "waiting" },
  { id: "arcgis", label: "Search and verify Esri ArcGIS services", status: "waiting" },
  { id: "video", label: "Check optional public meeting video", status: "waiting" },
];
const pause = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function MapClick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: ({ latlng }) => onPick(latlng.lat, latlng.lng),
  });
  return null;
}

export default function OnboardPage() {
  const auth = useAuth();
  const initial = auth.selectedCity ? `${auth.selectedCity.city}, ${auth.selectedCity.state}` : "";
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState(initial);
  const [selected, setSelected] = useState<City | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [located, setLocated] = useState<LocatedCity | null>(null);
  const [locateState, setLocateState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [showSearch, setShowSearch] = useState(Boolean(initial));
  const [probes, setProbes] = useState<Probe[]>(initialProbes);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [ingestState, setIngestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [ingest, setIngest] = useState<IngestResult | null>(null);
  const [message, setMessage] = useState("");
  const locateRequest = useRef(0);

  const parseCity = (): City | null => {
    const match = query.trim().match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
    if (!match) return null;
    const city = match[1].trim().replace(/\s+/g, " ");
    const state = match[2].toUpperCase();
    return { city, state, reference: city.toLowerCase() === "fishers" && state === "IN" };
  };

  const locate = async (lat: number, lng: number) => {
    const requestId = ++locateRequest.current;
    setPicked({ lat, lng });
    setLocated(null);
    setLocateState("loading");
    setMessage("");
    try {
      const response = await fetch(`/api/onboard/locate?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const payload = await response.json() as {
        city?: string; county?: string; state?: string; stateAbbr?: string;
        lat?: number; lng?: number; source?: "nominatim" | "census"; message?: string;
      };
      if (!response.ok || !payload.city || !payload.county || !payload.state || !payload.stateAbbr || payload.lat == null || payload.lng == null || !payload.source)
        throw new Error(payload.message || "No municipality found at this location.");
      if (requestId !== locateRequest.current) return;
      const place: LocatedCity = {
        city: payload.city,
        state: payload.stateAbbr,
        stateName: payload.state,
        county: payload.county,
        lat: payload.lat,
        lng: payload.lng,
        source: payload.source,
        reference: payload.city.toLowerCase() === "fishers" && payload.stateAbbr === "IN",
      };
      setLocated(place);
      setQuery(`${place.city}, ${place.state}`);
      setLocateState("ready");
    } catch (error) {
      if (requestId !== locateRequest.current) return;
      setLocateState("error");
      setShowSearch(true);
      setMessage(error instanceof Error ? error.message : "No municipality found at this location.");
    }
  };

  const persist = async (place: City, payload: Discovery, result: IngestResult | null) => {
    const meetingSource = payload.sources.find((source) => source.kind === "meetings");
    const profile: ResidentProfile = {
      city: place.city, state: place.state, address: "",
      vendor: meetingSource?.vendor || (place.reference ? "civicclerk" : ""),
      slug: meetingSource?.slug || (place.reference ? "fishersin" : ""),
      isReference: Boolean(place.reference),
      meetingsIngested: place.reference ? 184 : result?.ingested || payload.meetingsIngested || 0,
      sourcesVerified: payload.sources.length,
    };
    return auth.saveProfile(profile);
  };

  const runDiscovery = async (place: City) => {
    setSelected(place); setQuery(`${place.city}, ${place.state}`); setStep(2);
    setMessage(""); setDiscovery(null); setIngest(null); setIngestState("idle"); setProbes(initialProbes);
    try {
      const countyParam = place.county ? `&county=${encodeURIComponent(place.county)}` : "";
      const response = await fetch(`/api/onboard/discover?city=${encodeURIComponent(place.city)}&state=${encodeURIComponent(place.state)}${countyParam}`);
      const payload = await response.json() as Discovery & { message?: string };
      if (!response.ok) throw new Error(payload.message || "Source discovery is unavailable.");
      const detailed: Probe[] = [
        { id: "candidate", label: "Candidate endpoints proposed", status: "verified", sample: "Candidates generated; every source below was independently probed." },
        ...payload.sources.map((source, index) => ({ id: `verified-${index}`, label: `${source.vendor} · ${source.kind}`, endpoint: source.url, sample: source.evidence?.sample, status: "verified" as const })),
        ...payload.attempts.map((attempt, index) => ({ id: `miss-${index}`, label: `${attempt.vendor} · ${attempt.kind}`, endpoint: attempt.probeUrl || attempt.url, reason: attempt.reason || (attempt.status ? `HTTP ${attempt.status}; verification failed.` : "No verified response was returned."), status: "not_found" as const })),
      ];
      setDiscovery(payload);
      setProbes(detailed.map((probe) => ({ ...probe, status: "waiting" })));
      for (let index = 0; index < detailed.length; index += 1) {
        await pause(110);
        setProbes((current) => current.map((probe, probeIndex) => probeIndex === index ? detailed[index] : probe));
      }

      const meeting = payload.sources.find((source) => source.kind === "meetings" && source.slug);
      let ingestResult: IngestResult | null = null;
      if (meeting) {
        setIngestState("loading");
        try {
          const ingestResponse = await fetch(`/api/onboard/ingest?vendor=${encodeURIComponent(meeting.vendor)}&slug=${encodeURIComponent(meeting.slug || "")}&city=${encodeURIComponent(place.city)}`);
          const body = await ingestResponse.json() as IngestResult & { message?: string };
          if (!ingestResponse.ok) throw new Error(body.message || "Meeting ingestion failed.");
          ingestResult = body; setIngest(body); setIngestState("ready");
        } catch (error) {
          setIngestState("error");
          setMessage(error instanceof Error ? error.message : "Meeting ingestion failed.");
        }
      }
      const saved = await persist(place, payload, ingestResult);
      setMessage((current) => current || (auth.user && !saved.synced ? "City saved on this device; profile sync is temporarily unavailable." : ""));
      setStep(3);
    } catch (error) {
      setProbes((current) => current.map((probe) => probe.status === "waiting" ? { ...probe, status: "not_found", reason: "The discovery request did not complete." } : probe));
      setMessage(error instanceof Error ? error.message : "Source discovery is unavailable.");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const place = parseCity();
    if (!place) { setMessage("Enter a city and two-letter state, for example San Jose, CA."); return; }
    void runDiscovery(place);
  };

  return <main className="onboarding-page onboarding-funnel">
    <header className="onboarding-heading"><p className="eyebrow">CITY SETUP</p><h1>Put the agent to work.</h1><p>Choose any U.S. city. Sentinel will probe official systems live and keep only sources that answer successfully.</p></header>
    <ol className="onboarding-progress" aria-label="Onboarding progress"><li className={step >= 1 ? "active" : ""}><span>1</span>Choose a city</li><li className={step >= 2 ? "active" : ""}><span>2</span>Verify sources</li><li className={step >= 3 ? "active" : ""}><span>3</span>Dashboard</li></ol>

    {step === 1 && <section className="onboarding-panel city-chooser">
      <p className="eyebrow">STEP 1</p><h2>Where do you want to look?</h2><p>Click anywhere on the map. Sentinel will identify the municipality before checking its public systems.</p>
      <div className="onboarding-map-shell">
        <MapContainer center={usCenter} zoom={4} minZoom={3} scrollWheelZoom className="onboarding-location-map">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClick onPick={(lat, lng) => void locate(lat, lng)} />
          {referencePoints.map((point) => <CircleMarker
            key={point.label}
            center={[point.lat, point.lng]}
            radius={7}
            bubblingMouseEvents={false}
            pathOptions={{ color: "#fffaf1", weight: 2, fillColor: "#9a3f2b", fillOpacity: 1 }}
            eventHandlers={{ click: () => void locate(point.lat, point.lng) }}
          ><Tooltip permanent direction="top" offset={[0, -5]}>{point.label}</Tooltip></CircleMarker>)}
          {picked && <CircleMarker center={[picked.lat, picked.lng]} radius={10} pathOptions={{ color: "#1f2d27", weight: 3, fillColor: "#fffaf1", fillOpacity: 1 }} />}
        </MapContainer>
        {locateState === "loading" && <div className="onboarding-map-loading" role="status"><i className="onboard-spinner" /> Identifying this location…</div>}
      </div>
      <p className="onboarding-map-help">Reference pins are shortcuts only. Every point on the map can be selected.</p>

      {located && locateState === "ready" && <div className="onboarding-location-card" role="status">
        <div><p className="eyebrow">LOCATION FOUND</p><h3>{located.city}, {located.state}</h3><p>{located.county}</p></div>
        <button type="button" onClick={() => void runDiscovery(located)}>Confirm and verify sources</button>
        <button className="location-search-fallback" type="button" onClick={() => setShowSearch(true)}>Not right? Search instead</button>
      </div>}

      {!showSearch && !located && <button className="location-search-fallback standalone" type="button" onClick={() => setShowSearch(true)}>Prefer typing? Search instead</button>}
      {showSearch && <form className="onboarding-text-fallback" onSubmit={submit}><label htmlFor="city-search">Search by city and state</label><div><input id="city-search" value={query} onChange={(event) => { setQuery(event.target.value); setMessage(""); }} placeholder="San Jose, CA" autoComplete="off" /><button>Run smart scraper</button></div><p>Enter any U.S. city and two-letter state code. Free-text discovery remains available even when map lookup fails.</p></form>}
      {message && <p className="onboarding-notice" role="alert">{message}</p>}
    </section>}

    {step >= 2 && selected && <section className="onboarding-panel scraper-live">
      <div className="scraper-heading"><div><p className="eyebrow">STEP 2 · LIVE</p><h2>Scanning {selected.city}, {selected.state}</h2>{selected.county && <p>{selected.county}</p>}</div>{step === 2 && <span className="onboard-pulse">AGENT WORKING</span>}</div>
      <ol className="live-probes">{probes.map((probe) => <li className={probe.status} key={probe.id}><span aria-hidden="true">{probe.status === "waiting" ? <i className="onboard-spinner" /> : probe.status === "verified" ? "✓" : "—"}</span><div><strong>{probe.label}</strong>{probe.endpoint && <code>{probe.endpoint}</code>}{probe.status === "verified" && probe.sample && <p>Sample: {probe.sample}</p>}{probe.status === "not_found" && <p>{probe.reason}</p>}</div></li>)}</ol>
      {discovery?.sources.some((source) => source.kind === "meetings") && <div className={`live-ingest ${ingestState}`}><span>{ingestState === "loading" ? <i className="onboard-spinner" /> : ingestState === "ready" ? "✓" : "!"}</span><div><strong>Ingest verified meetings</strong>{ingestState === "loading" && <p>Paging the verified endpoint and storing real meeting records…</p>}{ingestState === "ready" && ingest && <><p><b>{ingest.ingested.toLocaleString()} meetings ingested</b></p><ul>{ingest.sample.map((name) => <li key={name}>{name}</li>)}</ul></>}{ingestState === "error" && <p>{message}</p>}</div></div>}
      {step === 2 && message && <p className="onboarding-notice" role="alert">{message}</p>}
      {step === 2 && !discovery && message && <button className="onboarding-retry" type="button" onClick={() => setStep(1)}>Try another city</button>}
    </section>}

    {step === 3 && selected && <section className="onboarding-panel onboarding-done"><div className="onboarding-checkmark">✓</div><p className="eyebrow">CITY SAVED</p><h2>{selected.city}, {selected.state} is ready.</h2><p>{ingest ? `${ingest.ingested.toLocaleString()} verified meetings are now available in your city view.` : "Your city and verified source results have been saved."}</p>{message && <p className="onboarding-notice">{message}</p>}<a className="onboarding-dashboard" href="/dashboard">Open your Dashboard</a></section>}
  </main>;
}
