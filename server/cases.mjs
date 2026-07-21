import { centroid, distanceMiles } from "./near.mjs";
import { readCache, readCaseCaches } from "./cache.mjs";

const LAND_USE_CASE = /^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?\d/i;
const GENERIC_HEADLINE = /^(?:fishers )?land[- ]use case$/i;
const STATUS_ORDER = {
  PENDING: 0,
  TABLED: 1,
  APPROVED: 2,
  DENIED: 3,
  WITHDRAWN: 4,
};
const CASE_LABELS = {
  RZ: "Rezoning",
  PUD: "PUD amendment",
  VA: "Variance",
  SE: "Special exception",
  ANX: "Annexation",
  TA: "Text amendment",
  SUP: "Special use permit",
  DP: "Development plan",
  PC: "Plan commission case",
};
const STREET_WORDS = new Map([
  ["road", "rd"],
  ["street", "st"],
  ["avenue", "ave"],
  ["boulevard", "blvd"],
  ["drive", "dr"],
  ["lane", "ln"],
  ["court", "ct"],
  ["circle", "cir"],
  ["trail", "trl"],
  ["trace", "trce"],
  ["parkway", "pkwy"],
  ["highway", "hwy"],
]);

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeCase = (value) =>
  clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeAddress = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/\b(east|west|north|south)\b/g, (word) => word[0])
    .replace(/\b(road|street|avenue|boulevard|drive|lane|court|circle|trail|trace|parkway|highway)\b/g, (word) => STREET_WORDS.get(word) || word)
    .replace(/[^a-z0-9]/g, "");
const status = (value) =>
  /approv/i.test(String(value || ""))
    ? "APPROVED"
    : /den|reject/i.test(String(value || ""))
      ? "DENIED"
      : /withdraw/i.test(String(value || ""))
        ? "WITHDRAWN"
        : /table|continu/i.test(String(value || ""))
          ? "TABLED"
          : "PENDING";
const firstName = (items) =>
  clean(
    (Array.isArray(items) ? items : [])
      .map((item) => (typeof item === "string" ? item : item?.name))
      .find(Boolean),
  ) || null;
const sentenceSummary = (value) => {
  const text = clean(value).replace(/\s*\[case_number:[^\]]+\]\s*/gi, " ");
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const summary = clean(sentences.slice(0, 2).join(" "));
  return summary.length > 420
    ? `${summary.slice(0, 417).replace(/\s+\S*$/, "")}…`
    : summary;
};
const titleHeadline = (payload, address) => {
  let title = clean(payload.title || payload.facts?.title || payload.facts?.request)
    .replace(/^consideration of (?:a|an|the)\s+/i, "")
    .replace(/^request to (?:approve|consider)\s+(?:a|an|the)?\s*/i, "")
    .replace(/^request for (?:approval of\s+)?(?:a|an|the)?\s*/i, "");
  if (title && !GENERIC_HEADLINE.test(title)) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return title.length > 130
      ? `${title.slice(0, 127).replace(/\s+\S*$/, "")}…`
      : title;
  }
  const prefix = clean(payload.case_number).match(/^([A-Z]+)/i)?.[1]?.toUpperCase();
  return `${CASE_LABELS[prefix] || "Planning case"}${address ? ` at ${address}` : ` ${clean(payload.case_number)}`}`;
};
const recentKey = (payload) => {
  const date = Date.parse(payload.meeting?.date || payload.facts?.meeting_date || "");
  if (Number.isFinite(date)) return date;
  const match = clean(payload.case_number).match(/-(\d{2})-(\d+)/);
  return match ? Date.UTC(2000 + Number(match[1]), 0, Number(match[2])) : 0;
};

function buildParcelIndex(db) {
  const index = new Map();
  if (!db) return index;
  for (const row of db
    .prepare("SELECT local_address,geometry_geojson FROM parcels WHERE local_address IS NOT NULL AND geometry_geojson IS NOT NULL")
    .all()) {
    const key = normalizeAddress(row.local_address);
    if (key && !index.has(key)) index.set(key, row);
  }
  return index;
}

function addressCandidates(address) {
  const value = clean(address).split(",", 1)[0];
  const candidates = [value];
  const combined = value.match(/^(\d+)\s*(?:&|and)\s*(\d+)\s+(.+)$/i);
  if (combined)
    candidates.push(`${combined[1]} ${combined[3]}`, `${combined[2]} ${combined[3]}`);
  return candidates;
}

export function createCaseCatalog(db) {
  const mapped = readCache(db, "map:cases");
  const mappedByCase = new Map(
    (Array.isArray(mapped) ? mapped : []).map((item) => [
      normalizeCase(item.case_number),
      item,
    ]),
  );
  const parcelIndex = buildParcelIndex(db);
  const cases = readCaseCaches(db)
    .filter((payload) => LAND_USE_CASE.test(clean(payload?.case_number)))
    .map((payload) => {
      const mapItem = mappedByCase.get(normalizeCase(payload.case_number));
      const parcelAddresses = Array.isArray(payload.facts?.parcels)
        ? payload.facts.parcels.map(clean).filter(Boolean)
        : [];
      let parcel = null;
      for (const address of parcelAddresses) {
        for (const candidate of addressCandidates(address)) {
          parcel = parcelIndex.get(normalizeAddress(candidate)) || null;
          if (parcel) break;
        }
        if (parcel) break;
      }
      const point =
        Number.isFinite(mapItem?.lat) && Number.isFinite(mapItem?.lng)
          ? { lat: mapItem.lat, lon: mapItem.lng }
          : centroid(parcel?.geometry_geojson);
      const address = clean(
        mapItem?.address || parcel?.local_address || parcelAddresses[0],
      );
      const headline = titleHeadline(payload, address);
      const whatItIs =
        sentenceSummary(payload.sections?.what_it_is) ||
        `${headline} is the request recorded in ${clean(payload.case_number)}.`;
      const ayes = payload.vote?.ayes ?? payload.facts?.vote_ayes;
      const nays = payload.vote?.nays ?? payload.facts?.vote_nays;
      const vote =
        ayes != null || nays != null
          ? `${Number(ayes || 0)}-${Number(nays || 0)}`
          : /^\d+\s*-\s*\d+$/.test(clean(payload.vote?.text))
            ? clean(payload.vote.text).replace(/\s/g, "")
            : null;
      const opposition = Array.isArray(payload.facts?.opposition)
        ? payload.facts.opposition
        : [];
      return {
        case_number: clean(payload.case_number),
        headline,
        what_it_is: whatItIs,
        status: status(payload.status || payload.facts?.status),
        address: address || null,
        applicant: firstName(payload.facts?.applicants),
        attorney: firstName(payload.facts?.attorneys),
        vote,
        meeting_date: clean(payload.meeting?.date || payload.facts?.meeting_date) || null,
        has_video: Boolean(
          payload.video_receipt ||
            payload.receipts?.some((receipt) => receipt?.kind === "video"),
        ),
        has_opposition: opposition.some((item) =>
          /oppos|remonstr|against|concern|object/i.test(clean(item)),
        ),
        lat: point?.lat ?? null,
        lng: point?.lon ?? null,
        _recent: recentKey(payload),
      };
    });

  return {
    query({ q = "", statuses = [], sort = "recent", address = "" } = {}) {
      const needle = clean(q).toLowerCase();
      const allowed = new Set(statuses.map(status));
      let resident = null;
      if (address && db) {
        const requested = clean(address);
        const row =
          db
            .prepare("SELECT local_address,geometry_geojson FROM parcels WHERE local_address = ? COLLATE NOCASE LIMIT 1")
            .get(requested) ||
          db
            .prepare("SELECT local_address,geometry_geojson FROM parcels WHERE local_address LIKE ? COLLATE NOCASE ORDER BY length(local_address) LIMIT 1")
            .get(`${requested}%`);
        resident = centroid(row?.geometry_geojson);
      }
      const output = cases
        .filter(
          (item) =>
            (!allowed.size || allowed.has(item.status)) &&
            (!needle ||
              `${item.headline} ${item.address || ""} ${item.case_number} ${item.applicant || ""}`
                .toLowerCase()
                .includes(needle)),
        )
        .map((item) => {
          const canMeasure =
            resident && Number.isFinite(item.lat) && Number.isFinite(item.lng);
          return {
            ...item,
            ...(address
              ? {
                  distance_mi: canMeasure
                    ? Number(
                        distanceMiles(resident, {
                          lat: item.lat,
                          lon: item.lng,
                        }).toFixed(1),
                      )
                    : null,
                }
              : {}),
          };
        })
        .sort((a, b) => {
          if (sort === "distance")
            return (
              (a.distance_mi ?? Number.POSITIVE_INFINITY) -
                (b.distance_mi ?? Number.POSITIVE_INFINITY) ||
              a.case_number.localeCompare(b.case_number, undefined, { numeric: true })
            );
          if (sort === "status")
            return (
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
              b._recent - a._recent ||
              a.case_number.localeCompare(b.case_number, undefined, { numeric: true })
            );
          return (
            b._recent - a._recent ||
            b.case_number.localeCompare(a.case_number, undefined, { numeric: true })
          );
        });
      return output.map(({ _recent, ...item }) => item);
    },
    count: cases.length,
  };
}
