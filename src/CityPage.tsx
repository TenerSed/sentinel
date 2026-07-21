import { FormEvent, useEffect, useState } from "react";

type CityMeeting = {
  eventId: string;
  name: string;
  body: string | null;
  startDateTime: string | null;
  documents: number;
  documentChars: number;
  url: string | null;
};

type CityPayload = {
  city: string;
  citySlug: string;
  state: string | null;
  vendor: string | null;
  vendorSlug: string | null;
  portalUrl: string | null;
  meetings: number;
  documents: number;
  documentChars: number;
  earliestMeeting: string | null;
  latestMeeting: string | null;
  depthLabel: string;
  bodies: { name: string; meetings: number }[];
  meetings_list?: CityMeeting[];
};

type CityResponse = CityPayload & {
  meetings: never;
} & Record<string, unknown>;

const PAGE_SIZE = 40;

function dateLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function CityPage({ slug }: { slug: string }) {
  const [summary, setSummary] = useState<Record<string, any> | null>(null);
  const [meetings, setMeetings] = useState<CityMeeting[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [bodyFilter, setBodyFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setState("loading");
    const params = new URLSearchParams({ slug, limit: String(PAGE_SIZE), offset: String(offset) });
    if (query) params.set("q", query);
    if (bodyFilter) params.set("body", bodyFilter);
    fetch(`/api/city?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message || "This city could not be loaded.");
        return payload;
      })
      .then((payload) => {
        setSummary(payload);
        setMeetings(payload.meetings || []);
        setTotal(payload.page?.total || 0);
        setState("ready");
      })
      .catch((error: Error) => {
        setMessage(error.message);
        setState("error");
      });
  }, [slug, offset, query, bodyFilter]);

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setQuery(searchInput.trim());
  };

  if (state === "error")
    return (
      <main className="city-boundary">
        <p className="eyebrow">CITY UNAVAILABLE</p>
        <h1>Nothing has been ingested for this city yet.</h1>
        <p>{message}</p>
        <a href="/onboarding">Onboard a city</a>
      </main>
    );

  return (
    <main className="city-page">
      <div className="city-data-label">
        <strong>
          {summary?.city || slug}
          {summary?.state ? `, ${summary.state}` : ""}
        </strong>
        <span>{summary?.depthLabel || "Loading ingested records…"}</span>
      </div>

      <header className="tool-heading">
        <div>
          <p className="eyebrow">INGESTED PUBLIC RECORD</p>
          <h1>
            {(summary?.meetingsTotal || 0).toLocaleString()} meetings from {summary?.city || slug}
          </h1>
          <p>
            Pulled directly from the verified {summary?.vendor || "vendor"} portal
            {summary?.earliestMeeting
              ? ` covering ${dateLabel(summary.earliestMeeting)} to ${dateLabel(summary.latestMeeting)}`
              : ""}
            . {(summary?.documents || 0).toLocaleString()} agenda/minutes documents with{" "}
            {(summary?.documentChars || 0).toLocaleString()} characters of extracted text.
          </p>
        </div>
        {summary?.portalUrl && (
          <a href={summary.portalUrl} target="_blank" rel="noreferrer">
            Source portal →
          </a>
        )}
      </header>

      {/* Degrade honestly: name exactly what this city does not have yet. */}
      <div className="city-gap-banner" role="note">
        <strong>What this city does not have yet.</strong>
        <span>
          No parcel geometry, no meeting video or transcripts, no entity graph, and no case-level
          extraction. Those are built only for the reference city, Fishers, IN — and Fishers records
          are never shown here in their place.
        </span>
      </div>

      <div className="tracker-toolbar">
        <form onSubmit={applySearch}>
          <label htmlFor="city-search">Search meetings</label>
          <div>
            <input
              id="city-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Committee, board, or meeting name"
            />
            <button>Search</button>
          </div>
        </form>
        {summary?.bodies?.length ? (
          <select
            aria-label="Filter by body"
            value={bodyFilter}
            onChange={(event) => {
              setOffset(0);
              setBodyFilter(event.target.value);
            }}
          >
            <option value="">All bodies ({(summary.meetingsTotal || 0).toLocaleString()})</option>
            {summary.bodies.map((body: { name: string; meetings: number }) => (
              <option key={body.name} value={body.name}>
                {body.name} ({body.meetings})
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="tracker-result-meta">
        <strong>
          {state === "loading"
            ? "Loading meetings…"
            : `${total.toLocaleString()} meeting${total === 1 ? "" : "s"}`}
        </strong>
        <span>
          {query || bodyFilter ? "Filtered" : "All"} ingested records · showing {offset + 1}–
          {Math.min(offset + meetings.length, total)}
        </span>
      </div>

      <div className="city-meeting-list">
        {state === "loading" && Array.from({ length: 8 }, (_, index) => <div className="city-meeting-row loading" key={index} />)}
        {state === "ready" &&
          meetings.map((meeting) => (
            <a
              className="city-meeting-row"
              key={meeting.eventId}
              href={meeting.url || undefined}
              target="_blank"
              rel="noreferrer"
            >
              <time>{dateLabel(meeting.startDateTime)}</time>
              <div>
                <strong>{meeting.name}</strong>
                <small>{meeting.body || "Body not listed"}</small>
              </div>
              <span className="city-meeting-docs">
                {meeting.documents
                  ? `${meeting.documents} doc${meeting.documents === 1 ? "" : "s"} · ${meeting.documentChars.toLocaleString()} chars`
                  : "no text pulled yet"}
              </span>
            </a>
          ))}
        {state === "ready" && !meetings.length && (
          <div className="tracker-empty">
            <strong>No ingested meeting matches this filter.</strong>
          </div>
        )}
      </div>

      <div className="city-pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>
          ← Previous
        </button>
        <span>
          Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(Math.ceil(total / PAGE_SIZE), 1)}
        </span>
        <button
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next →
        </button>
      </div>
    </main>
  );
}
