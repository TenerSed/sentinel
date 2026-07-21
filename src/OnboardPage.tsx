import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { ResidentProfile, useAuth } from "./AuthContext";
import LivePipeline, { PipelineResult } from "./LivePipeline";
import "leaflet/dist/leaflet.css";

type City = { city: string; state: string; county?: string; reference?: boolean };
type LocatedCity = City & { county: string; stateName: string; lat: number; lng: number; source: "nominatim" | "census" };
type Source = { kind: string; vendor: string; slug?: string; url: string; evidence?: { status?: number; sample?: string; firstPageRecords?: number } };
type Attempt = { kind: string; vendor: string; slug?: string; url?: string | null; probeUrl?: string; status?: number | null; reason?: string; verified?: boolean };
type Discovery = { city: string; state: string; county?: string | null; sources: Source[]; attempts: Attempt[]; meetingsIngested?: number };
type Probe = { id: string; label: string; endpoint?: string | null; sample?: string; reason?: string; status: "waiting" | "verified" | "not_found" };
type IngestResult = { ingested: number; sample: string[] };
type IngestJob = {
  job: string;
  stage: string;
  status: "running" | "done" | "failed";
  meetings: number;
  documents: number;
  documentChars: number;
  sample?: string[];
  errors?: string[];
};

const referencePoints = [
  { label: "Fishers, IN · fully indexed", lat: 39.9568, lng: -86.0125 },
  { label: "San Jose, CA", lat: 37.3382, lng: -121.8863 },
  { label: "Carmel, IN", lat: 39.9784, lng: -86.118 },
];
function FlyTo({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo([target.lat, target.lng], 11, { duration: 0.8 }); }, [target, map]);
  return null;
}
const defaultCities: Suggestion[] = [
  { label: "Fishers, IN", city: "Fishers", state: "Indiana", stateAbbr: "IN", county: "Hamilton County", lat: 39.9568, lng: -86.0125 },
  { label: "Carmel, IN", city: "Carmel", state: "Indiana", stateAbbr: "IN", county: "Hamilton County", lat: 39.9784, lng: -86.118 },
  { label: "San Jose, CA", city: "San Jose", state: "California", stateAbbr: "CA", county: "Santa Clara County", lat: 37.3382, lng: -121.8863 },
  { label: "Oakland, CA", city: "Oakland", state: "California", stateAbbr: "CA", county: "Alameda County", lat: 37.8044, lng: -122.2712 },
  { label: "Austin, TX", city: "Austin", state: "Texas", stateAbbr: "TX", county: "Travis County", lat: 30.2672, lng: -97.7431 },
  { label: "Raleigh, NC", city: "Raleigh", state: "North Carolina", stateAbbr: "NC", county: "Wake County", lat: 35.7804, lng: -78.6391 },
];
type Suggestion = { label: string; city: string; state: string; stateAbbr: string; county: string; lat: number; lng: number };
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);
  const suggestTimer = useRef<number>();
  const [probes, setProbes] = useState<Probe[]>(initialProbes);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [ingestState, setIngestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [ingest, setIngest] = useState<IngestResult | null>(null);
  const [progress, setProgress] = useState<IngestJob | null>(null);
  const [message, setMessage] = useState("");
  const [graphNodes, setGraphNodes] = useState(0);
  const locateRequest = useRef(0);

  useEffect(() => {
    window.clearTimeout(suggestTimer.current);
    const term = query.trim();
    if (term.length < 3) { setSuggestions([]); setSearching(false); return; }
    suggestTimer.current = window.setTimeout(() => {
      setSearching(true);
      fetch(`/api/onboard/search-city?q=${encodeURIComponent(term)}`)
        .then((response) => response.json())
        .then((rows: Suggestion[]) => setSuggestions(Array.isArray(rows) ? rows.slice(0, 5) : []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(suggestTimer.current);
  }, [query]);

  const chooseSuggestion = (row: Suggestion) => {
    setSuggestions([]);
    setPicked({ lat: row.lat, lng: row.lng });
    setLocated({ city: row.city, state: row.stateAbbr || row.state, stateName: row.state, county: row.county, lat: row.lat, lng: row.lng, source: "nominatim" });
    setLocateState("ready");
    setMessage("");
  };

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

  // The live pipeline screen owns discovery, ingestion and the graph build; this
  // only moves the user onto it.
  const runDiscovery = (place: City) => {
    setSelected(place);
    setQuery(`${place.city}, ${place.state}`);
    setMessage("");
    setDiscovery(null);
    setIngest(null);
    setIngestState("idle");
    setGraphNodes(0);
    setStep(2);
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
      <p className="eyebrow">STEP 1</p><h2>Which city should Sentinel read?</h2><p>Search any U.S. city — we drop a pin and confirm the municipality before probing its public systems. You can also click the map directly.</p>
      <div className="onboarding-citysearch">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search any U.S. city — e.g. Raleigh, NC"
          aria-label="Search for a city"
          onFocus={(event) => { event.currentTarget.select(); setFocused(true); }}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          autoFocus
        />
        {searching && <span className="onboarding-citysearch-status">Searching…</span>}
        {(suggestions.length > 0 || (focused && query.trim().length < 3)) && <ul className="onboarding-suggestions">
          {(suggestions.length > 0 ? suggestions : defaultCities).map((row) => (
            <li key={`${row.label}-${row.lat}`}>
              <button type="button" onClick={() => chooseSuggestion(row)}>
                <b>{row.city}, {row.stateAbbr || row.state}</b>
                <span>{row.county}</span>
              </button>
            </li>
          ))}
        </ul>}
      </div>
      <div className="onboarding-map-shell">
        <MapContainer center={usCenter} zoom={4} minZoom={3} scrollWheelZoom className="onboarding-location-map">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClick onPick={(lat, lng) => void locate(lat, lng)} />
          <FlyTo target={picked} />
          {referencePoints.map((point) => <CircleMarker
            key={point.label}
            center={[point.lat, point.lng]}
            radius={7}
            bubblingMouseEvents={false}
            pathOptions={{ color: "#fffaf1", weight: 2, fillColor: "#9a3f2b", fillOpacity: 1 }}
            eventHandlers={{ click: () => void locate(point.lat, point.lng) }}
          ><Tooltip direction="top" offset={[0, -8]}>{point.label}</Tooltip></CircleMarker>)}
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

    {step === 2 && selected && (
      <LivePipeline
        city={selected.city}
        state={selected.state}
        county={selected.county}
        onFailure={(issue) => setMessage(issue)}
        onComplete={(result: PipelineResult) => {
          void (async () => {
            const payload: Discovery = {
              city: result.city,
              state: result.state,
              county: result.county ?? null,
              sources: result.sources as Source[],
              attempts: [],
              meetingsIngested: result.meetingsIngested,
            };
            setDiscovery(payload);
            setIngest({ ingested: result.meetingsIngested, sample: [] });
            setIngestState("ready");
            setGraphNodes(result.graphNodes);
            const saved = await persist(selected, payload, {
              ingested: result.meetingsIngested,
              sample: [],
            });
            setMessage((current) =>
              current ||
              (auth.user && !saved.synced
                ? "City saved on this device; profile sync is temporarily unavailable."
                : ""),
            );
            setStep(3);
          })();
        }}
      />
    )}

    {step === 3 && selected && <section className="onboarding-panel onboarding-done"><div className="onboarding-checkmark">✓</div><p className="eyebrow">CITY SAVED</p><h2>{selected.city}, {selected.state} is ready.</h2><p>{ingest ? `${ingest.ingested.toLocaleString()} verified meetings are now available in your city view.${graphNodes ? ` ${graphNodes.toLocaleString()} entities were extracted into this city's graph.` : ""}` : "Your city and verified source results have been saved."}</p>{message && <p className="onboarding-notice">{message}</p>}<a className="onboarding-dashboard" href="/dashboard">Open your Dashboard</a></section>}
  </main>;
}
