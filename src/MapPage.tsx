import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polygon,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useAuth } from "./AuthContext";
import "leaflet/dist/leaflet.css";

type CaseItem = {
  case_number: string;
  headline: string;
  status: "APPROVED" | "DENIED" | "WITHDRAWN" | "TABLED" | "PENDING";
  what_it_is: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  applicant: string | null;
  vote: string | null;
  has_video: boolean;
  has_opposition: boolean;
};
type Parcel = {
  address: string;
  lat: number;
  lng: number;
  polygon: number[][][] | number[][][][];
};
type Health = {
  neo4j: boolean;
  cache: { keys: number; built_at: string | null };
  db: boolean;
};
const fishers: [number, number] = [39.9568, -86.0125];
const colors: Record<CaseItem["status"], string> = {
  APPROVED: "#9a3f2b",
  PENDING: "#c48724",
  DENIED: "#6d706d",
  WITHDRAWN: "#42665b",
  TABLED: "#776652",
};
const label = (status: CaseItem["status"]) =>
  status === "TABLED"
    ? "Tabled"
    : status.charAt(0) + status.slice(1).toLowerCase();
function MoveMap({
  target,
  zoom = 15,
}: {
  target?: [number, number];
  zoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, zoom, { duration: 0.55 });
  }, [map, target, zoom]);
  return null;
}
function FitCases({ cases }: { cases: CaseItem[] }) {
  const map = useMap();
  useEffect(() => {
    if (cases.length)
      map.fitBounds(
        cases.map((item) => [item.lat!, item.lng!] as [number, number]),
        { maxZoom: 14, padding: [36, 36] },
      );
  }, [map, cases]);
  return null;
}

export default function MapPage() {
  const { tracked } = useAuth();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [casesState, setCasesState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [health, setHealth] = useState<Health>();
  const [query, setQuery] = useState(""),
    [address, setAddress] = useState(""),
    [matches, setMatches] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Set<CaseItem["status"]>>(
    new Set(["APPROVED", "PENDING", "DENIED", "WITHDRAWN", "TABLED"]),
  );
  const [caseType, setCaseType] = useState("");
  const [videoOnly, setVideoOnly] = useState(false);
  const [oppositionOnly, setOppositionOnly] = useState(false);
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [parcel, setParcel] = useState<Parcel>(),
    [parcelState, setParcelState] = useState<"idle" | "loading" | "error">(
      "idle",
    ),
    [selected, setSelected] = useState<string>(),
    [mobileOpen, setMobileOpen] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/health")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((x: Health | undefined) => active && setHealth(x))
      .catch(() => undefined);
    void fetch("/api/cases?sort=recent")
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || !Array.isArray(x)) throw new Error(x?.message);
        return x;
      })
      .then((data: CaseItem[]) => {
        if (active) {
          setCases(data);
          setCasesState("ready");
        }
      })
      .catch(() => active && setCasesState("error"));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const value = address.trim();
    if (value.length < 2) {
      setMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`/api/near/addresses?q=${encodeURIComponent(value)}&limit=8`)
        .then((r) => r.json())
        .then((data: { addresses?: string[] }) =>
          setMatches(data.addresses || []),
        )
        .catch(() => setMatches([]));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [address]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter(
      (item) =>
        statuses.has(item.status) &&
        (!caseType || item.case_number.startsWith(`${caseType}-`)) &&
        (!videoOnly || item.has_video) &&
        (!oppositionOnly || item.has_opposition) &&
        (!trackedOnly || tracked.has(item.case_number)) &&
        (!needle ||
          `${item.case_number} ${item.headline} ${item.address}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [caseType, cases, oppositionOnly, query, statuses, tracked, trackedOnly, videoOnly]);
  const mappedVisible = visible.filter(
    (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
  );
  const focus = selected
    ? mappedVisible.find((item) => item.case_number === selected)
    : undefined;
  const selectAddress = (value: string) => {
    setAddress(value);
    setMatches([]);
    setParcel(undefined);
    setParcelState("loading");
    fetch(`/api/map/parcel?address=${encodeURIComponent(value)}`)
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok || x?.error) throw new Error();
        return x;
      })
      .then((data: Parcel) => {
        setParcel(data);
        setParcelState("idle");
      })
      .catch(() => setParcelState("error"));
  };
  const toggle = (item: CaseItem["status"]) =>
    setStatuses((current) => {
      const next = new Set(current);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  const polygon = parcel?.polygon as unknown as
    | [number, number][][]
    | undefined;

  return (
    <main className="map-page">
      <aside className={`map-rail ${mobileOpen ? "open" : ""}`}>
        {!health?.neo4j && health && (
          <div className="map-data-banner" role="status">
            {casesState === "ready"
              ? "Live graph is offline — showing cached public-record data"
              : "Live graph is offline — map data is unavailable"}
          </div>
        )}
        <button
          className="map-mobile-toggle"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? "Hide search" : "Search the map"}
        </button>
        <div className="map-rail-content">
          <p className="map-kicker">GEOGRAPHIC CASE VIEW</p>
          <h1>Map the same case set.</h1>
          <p className="map-purpose">Use the same core filters as Tracker, then open any marker’s public record.</p>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (matches[0]) selectAddress(matches[0]);
            }}
            className="map-address"
          >
            <label htmlFor="map-address">Your address</label>
            <input
              id="map-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Start typing a Fishers address"
              autoComplete="off"
            />
            {matches.length > 0 && (
              <ul>
                {matches.map((item) => (
                  <li key={item}>
                    <button type="button" onClick={() => selectAddress(item)}>
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </form>
          {parcelState === "loading" && (
            <p className="map-load-message" role="status">
              Locating your parcel…
            </p>
          )}
          {parcelState === "error" && (
            <p className="map-error-message" role="alert">
              That parcel could not be loaded. Choose another suggested address.
            </p>
          )}
          <label className="map-filter-label" htmlFor="map-filter">
            Filter cases
          </label>
          <input
            id="map-filter"
            className="map-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Case, project, or address"
          />
          <div className="map-chips">
            {(["APPROVED", "PENDING", "DENIED", "WITHDRAWN", "TABLED"] as const).map(
              (item) => (
                <button
                  key={item}
                  className={statuses.has(item) ? "active" : ""}
                  onClick={() => toggle(item)}
                >
                  {label(item)}
                </button>
              ),
            )}
          </div>
          <div className="map-facets">
            <label>Case type<select value={caseType} onChange={(event) => setCaseType(event.target.value)}><option value="">All types</option><option value="RZ">Rezoning</option><option value="PUD">PUD</option><option value="VA">Variance</option><option value="SE">Special exception</option><option value="ANX">Annexation</option><option value="TA">Text amendment</option></select></label>
            <label><input type="checkbox" checked={videoOnly} onChange={() => setVideoOnly((value) => !value)} /> Has video receipt</label>
            <label><input type="checkbox" checked={oppositionOnly} onChange={() => setOppositionOnly((value) => !value)} /> Public opposition</label>
            <label><input type="checkbox" checked={trackedOnly} onChange={() => setTrackedOnly((value) => !value)} /> Tracked ({tracked.size})</label>
          </div>
          {casesState === "loading" && (
            <p className="map-load-message" role="status">
              <span className="resident-spinner" /> Loading cached land-use
              cases…
            </p>
          )}
          {casesState === "error" && (
            <p className="map-error-message" role="alert">
              Mapped cases are unavailable because neither cached data nor the
              live graph could be read.
            </p>
          )}
          {casesState === "ready" && (
            <>
              <p className="map-results-count">
                {visible.length} cases · {mappedVisible.length} mapped
              </p>
              <div className="map-results">
                {visible.map((item) => (
                  <button
                    className={selected === item.case_number ? "active" : ""}
                    key={item.case_number}
                    onMouseEnter={() => setSelected(item.case_number)}
                    onFocus={() => setSelected(item.case_number)}
                    onClick={() =>
                      (window.location.href = `/case?case=${encodeURIComponent(item.case_number)}`)
                    }
                  >
                    <span className="map-case-number">{item.case_number}</span>
                    <strong>{item.headline}</strong>
                    <em className={`map-status ${item.status}`}>
                      {label(item.status)}
                    </em>
                    <small>{item.address}</small>
                    <small>Open case →</small>
                  </button>
                ))}
                {!visible.length && (
                  <p>No cases match these filters in the current snapshot.</p>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
      <section className="map-canvas">
        <MapContainer
          center={fishers}
          zoom={12}
          scrollWheelZoom
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitCases
            cases={cases.filter(
              (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
            )}
          />
          {mappedVisible.map((item) => (
            <CircleMarker
              key={item.case_number}
              center={[item.lat!, item.lng!]}
              radius={selected === item.case_number ? 10 : 7}
              pathOptions={{
                color: "#fffaf1",
                weight: 2,
                fillColor: colors[item.status],
                fillOpacity: 1,
              }}
              eventHandlers={{
                click: () => setSelected(item.case_number),
                mouseover: () => setSelected(item.case_number),
              }}
            >
              <Popup>
                <div className="map-popup">
                  <span>{item.case_number}</span>
                  <strong>{item.headline}</strong>
                  <em>{label(item.status)}</em>
                  <small>{item.address}</small>
                  {item.applicant && <small>Applicant: {item.applicant}</small>}
                  {item.vote && <small>Vote: {item.vote}</small>}
                  <a
                    href={`/case?case=${encodeURIComponent(item.case_number)}`}
                  >
                    Open case →
                  </a>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {parcel && (
            <>
              <CircleMarker
                center={[parcel.lat, parcel.lng]}
                radius={9}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: "#1f2d27",
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  Your home
                  <br />
                  <strong>{parcel.address}</strong>
                </Popup>
              </CircleMarker>
              <Polygon
                positions={polygon || []}
                pathOptions={{
                  color: "#1f2d27",
                  weight: 3,
                  fillColor: "#b8754b",
                  fillOpacity: 0.12,
                }}
              />
              <Circle
                center={[parcel.lat, parcel.lng]}
                radius={3218.69}
                pathOptions={{
                  color: "#1f2d27",
                  weight: 1,
                  dashArray: "5 8",
                  fillOpacity: 0.025,
                }}
              />
            </>
          )}
          {
            <MoveMap
              target={
                parcel
                  ? [parcel.lat, parcel.lng]
                  : focus
                    ? [focus.lat!, focus.lng!]
                    : undefined
              }
              zoom={parcel ? 16 : 15}
            />
          }
        </MapContainer>
        <div className="map-legend">
          <span>
            <i className="approved" />
            Approved
          </span>
          <span>
            <i className="pending" />
            Pending
          </span>
          <span>
            <i className="denied" />
            Denied
          </span>
          <span>
            <i className="withdrawn" />
            Withdrawn
          </span>
        </div>
      </section>
    </main>
  );
}
