import { narrate, predict } from "./insights.mjs";

const n = (v) =>
  typeof v?.toNumber === "function" ? v.toNumber() : Number(v || 0);
const value = (v) => (typeof v?.toNumber === "function" ? v.toNumber() : v);
const row = (r) =>
  Object.fromEntries(
    Object.entries(r.toObject()).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.map(value) : value(v),
    ]),
  );
const norm = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const decided =
  "toLower(coalesce(c.status,'')) CONTAINS 'approv' OR toLower(coalesce(c.status,'')) CONTAINS 'den' OR toLower(coalesce(c.status,'')) CONTAINS 'withdraw' OR toLower(coalesce(c.status,'')) CONTAINS 'table'";
const landUse =
  "c.case_number =~ '(?i)^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?.*' OR toLower(coalesce(c.case_type,'')) =~ '.*(rezon|varianc|pud|annex|special[ -]?exception|plat).*'";
const outcome = (status) =>
  /approv/i.test(String(status))
    ? "APPROVED"
    : /den|reject/i.test(String(status))
      ? "DENIED"
      : /withdraw/i.test(String(status))
        ? "WITHDRAWN"
        : /table|continu/i.test(String(status))
          ? "TABLED"
          : "PENDING";
const uniqueNames = (names) => [
  ...new Map(names.filter(Boolean).map((name) => [norm(name), name])).values(),
];
const compact = (text, terms = []) => {
  const source = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  const i =
    terms
      .map((term) =>
        source.toLowerCase().indexOf(String(term || "").toLowerCase()),
      )
      .find((x) => x >= 0) ?? 0;
  return source.slice(Math.max(0, i - 130), Math.max(0, i - 130) + 340);
};
const fallbackComment = (facts) =>
  `I am writing about ${facts.case_number}. As a nearby resident, I ask the board to make its findings and the public-record evidence clear before acting on this request. Please address the change requested${facts.parcel ? ` at ${facts.parcel}` : ""}, its likely neighborhood effects, and the concerns raised in the record. I respectfully ask that this comment and the response to it be included in the public file for ${facts.case_number}.`;
const cite = (text, caseNumber) =>
  String(text || "").includes(caseNumber)
    ? String(text)
    : `${String(text || "").trim()} [case_number: ${caseNumber}]`;
const homeLandUse = "c.case_number =~ '(?i)^(RZ|PUD|VA|SE|ANX|TA)-?.*'";
const homeDecided =
  "toLower(coalesce(c.status,'')) CONTAINS 'approv' OR toLower(coalesce(c.status,'')) CONTAINS 'den' OR toLower(coalesce(c.status,'')) CONTAINS 'withdraw' OR toLower(coalesce(c.status,'')) CONTAINS 'table' OR toLower(coalesce(c.status,'')) CONTAINS 'continu'";
const CITYWIDE_LIMIT = 8;

export function centroid(geojson) {
  try {
    const geometry =
      typeof geojson === "string" ? JSON.parse(geojson) : geojson;
    const ring =
      geometry?.type === "Polygon"
        ? geometry.coordinates?.[0]
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates?.[0]?.[0]
          : null;
    if (!Array.isArray(ring) || !ring.length) return null;
    const points = ring.filter(
      (point) =>
        Array.isArray(point) &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    );
    if (!points.length) return null;
    return {
      lon: points.reduce((sum, point) => sum + point[0], 0) / points.length,
      lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
    };
  } catch {
    return null;
  }
}
export function distanceMiles(a, b) {
  const radians = Math.PI / 180,
    meanLat = ((a.lat + b.lat) / 2) * radians;
  return Math.hypot((a.lon - b.lon) * Math.cos(meanLat), a.lat - b.lat) * 69.09;
}
function cleanHeadline(caseRow) {
  const title = String(caseRow.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (title) return title.slice(0, 90);
  let request = String(caseRow.request || "")
    .replace(/\s+/g, " ")
    .trim();
  request = request
    .replace(/^consideration of (?:a|an|the)\s+/i, "")
    .replace(/^request (?:for|to)\s+/i, "");
  if (!request) return "Land-use case";
  request = request.charAt(0).toUpperCase() + request.slice(1);
  return request.length > 90 ? `${request.slice(0, 87).trimEnd()}…` : request;
}
function statusVerb(status) {
  if (/approv/i.test(String(status))) return "was approved";
  if (/den|reject/i.test(String(status))) return "was denied";
  if (/withdraw/i.test(String(status))) return "was withdrawn";
  if (/table|continu/i.test(String(status))) return "was continued";
  return "is pending or upcoming";
}
function caseScore(caseRow) {
  return [caseRow.request, caseRow.title, caseRow.status].filter((value) =>
    String(value || "").trim(),
  ).length;
}
function dedupeCases(cases) {
  const chosen = new Map();
  for (const item of cases) {
    const key = norm(item.case_number);
    if (!key) continue;
    const current = chosen.get(key);
    if (
      !current ||
      (Number.isFinite(item.distance) &&
        (!Number.isFinite(current.distance) ||
          item.distance < current.distance)) ||
      caseScore(item) > caseScore(current)
    )
      chosen.set(key, item);
  }
  return [...chosen.values()];
}
function caseItem(caseRow, extra = {}) {
  return {
    case_number: caseRow.case_number,
    headline: cleanHeadline(caseRow),
    status: outcome(caseRow.status),
    status_line: statusVerb(caseRow.status),
    notable: Boolean(caseRow.opposition),
    ...extra,
  };
}

export async function homeStats(driver, db) {
  const sqlite = {
    videos: Number(
      db
        ?.prepare(
          "SELECT count(DISTINCT video_id) AS count FROM yt_transcript_cues",
        )
        .get()?.count || 0,
    ),
    parcels: Number(
      db?.prepare("SELECT count(*) AS count FROM parcels").get()?.count || 0,
    ),
  };
  if (!driver)
    return {
      meetings: 0,
      cases: 0,
      documents: 0,
      decisions: 0,
      parcels: sqlite.parcels,
      videos: sqlite.videos,
      people: 0,
      organizations: 0,
    };
  const session = driver.session();
  try {
    const result = await session.run(`
      CALL { MATCH (m:Meeting) RETURN count(m) AS meetings }
      CALL { MATCH (c:Case) RETURN count(c) AS cases }
      CALL { MATCH (d:Document) RETURN count(d) AS documents }
      CALL { MATCH (c:Case) WHERE (${homeDecided}) RETURN count(c) AS decisions }
      CALL { MATCH (p:Person) RETURN count(p) AS people }
      CALL { MATCH (o:Organization) RETURN count(o) AS organizations }
      RETURN meetings,cases,documents,decisions,people,organizations
    `);
    const data = result.records[0] ? row(result.records[0]) : {};
    return {
      meetings: n(data.meetings),
      cases: n(data.cases),
      documents: n(data.documents),
      decisions: n(data.decisions),
      parcels: sqlite.parcels,
      videos: sqlite.videos,
      people: n(data.people),
      organizations: n(data.organizations),
    };
  } finally {
    await session.close();
  }
}

export async function homeHighlights(driver) {
  if (!driver) return [];
  const session = driver.session();
  try {
    const approvedOpposition = await session.run(
      `MATCH (c:Case),(s:OpenEntity:Sentiment) WHERE (${homeLandUse}) AND toLower(coalesce(c.status,'')) CONTAINS 'approv' AND c.source_id=s.source_id RETURN c.case_number AS case_number,c.vote_ayes AS ayes,c.vote_nays AS nays,count(DISTINCT s) AS opposition ORDER BY opposition DESC, c.case_number DESC LIMIT 1`,
    );
    const attorney = await session.run(
      `MATCH (a:Person)-[:REPRESENTS]->()-[:APPLICANT_FOR]->(c:Case) WHERE a.name IS NOT NULL AND (${homeLandUse}) WITH a,c WHERE (${homeDecided}) WITH toLower(trim(a.name)) AS key,collect(DISTINCT {name:a.name,case_number:c.case_number,status:c.status}) AS rows WITH key, rows, head(rows).name AS name, size(rows) AS decided, size([x IN rows WHERE toLower(coalesce(x.status,'')) CONTAINS 'approv']) AS approved WHERE decided > 0 RETURN name,decided,approved,head(rows).case_number AS case_number ORDER BY (toFloat(approved) / decided) DESC, decided DESC LIMIT 1`,
    );
    const repeat = await session.run(
      `MATCH (a)-[:APPLICANT_FOR]->(c:Case) WHERE (a:Organization OR a:Person) AND a.name IS NOT NULL AND (${homeLandUse}) WITH toLower(trim(a.name)) AS key,collect(DISTINCT {name:a.name,case_number:c.case_number}) AS rows WITH key, rows, head(rows).name AS name, size(rows) AS filings WHERE filings > 1 RETURN name,filings,head(rows).case_number AS case_number ORDER BY filings DESC LIMIT 1`,
    );
    const rezoning = await session.run(
      `MATCH (c:Case)-[:REZONE_FROM]->(from:ZoningDistrict) MATCH (c)-[:REZONE_TO]->(to:ZoningDistrict) WHERE (${homeLandUse}) AND from.code IS NOT NULL AND to.code IS NOT NULL AND from.code <> to.code RETURN c.case_number AS case_number,from.code AS from_code,to.code AS to_code,c.status AS status ORDER BY CASE WHEN (${homeDecided}) THEN 0 ELSE 1 END,c.case_number DESC LIMIT 1`,
    );
    const highlights = [];
    const opposition =
      approvedOpposition.records[0] && row(approvedOpposition.records[0]);
    if (opposition?.case_number && n(opposition.opposition) > 0) {
      const vote =
        opposition.ayes == null && opposition.nays == null
          ? "Approved"
          : `Approved ${n(opposition.ayes)}-${n(opposition.nays)}`;
      highlights.push({
        kind: "approved_despite_opposition",
        headline: `${vote} despite ${n(opposition.opposition)} linked resident concern${n(opposition.opposition) === 1 ? "" : "s"}`,
        stat: `${opposition.case_number} · public-comment signals linked in the record`,
        case_number: opposition.case_number,
        entity: null,
        href: `/case?case=${encodeURIComponent(opposition.case_number)}`,
      });
    }
    const attorneyRow = attorney.records[0] && row(attorney.records[0]);
    if (attorneyRow?.name && n(attorneyRow.decided) > 0)
      highlights.push({
        kind: "representative_win_rate",
        headline: `${attorneyRow.name}: ${n(attorneyRow.approved)} of ${n(attorneyRow.decided)} decided land-use cases approved`,
        stat: "Decided cases only · linked as a case representative",
        case_number: attorneyRow.case_number,
        entity: attorneyRow.name,
        href: `/case?case=${encodeURIComponent(attorneyRow.case_number)}`,
      });
    const repeatRow = repeat.records[0] && row(repeat.records[0]);
    if (repeatRow?.name && n(repeatRow.filings) > 1)
      highlights.push({
        kind: "repeat_applicant",
        headline: `${repeatRow.name}: ${n(repeatRow.filings)} land-use filings in the public record`,
        stat: "Repeat applicant / developer",
        case_number: repeatRow.case_number,
        entity: repeatRow.name,
        href: `/case?case=${encodeURIComponent(repeatRow.case_number)}`,
      });
    const rezoneRow = rezoning.records[0] && row(rezoning.records[0]);
    if (rezoneRow?.case_number)
      highlights.push({
        kind: "rezoning",
        headline: `${rezoneRow.case_number} would change zoning from ${rezoneRow.from_code} to ${rezoneRow.to_code}`,
        stat: rezoneRow.status || "Land-use case",
        case_number: rezoneRow.case_number,
        entity: null,
        href: `/case?case=${encodeURIComponent(rezoneRow.case_number)}`,
      });
    return highlights.slice(0, 4);
  } finally {
    await session.close();
  }
}

function receipts(db, documents, terms) {
  const output = [];
  for (const doc of documents) {
    const id = String(doc.source_id || doc.doc_id || "").replace(/^file:/, "");
    const file =
      db && id
        ? db
            .prepare(
              "SELECT name,plaintext,stream_url FROM cc_files WHERE file_id=?",
            )
            .get(id)
        : null;
    output.push({
      kind: "document",
      title: file?.name || doc.title || "Public record",
      snippet: compact(
        file?.plaintext || `Public record linked to ${doc.case_number}.`,
        terms,
      ),
      url: file?.stream_url || doc.url || null,
      case_number: doc.case_number,
    });
  }
  if (!output.length && db && terms[0]) {
    const file = db
      .prepare(
        "SELECT name,plaintext,stream_url FROM cc_files WHERE lower(plaintext) LIKE ? LIMIT 2",
      )
      .all(`%${String(terms[0]).toLowerCase()}%`);
    for (const item of file)
      output.push({
        kind: "document",
        title: item.name || "Public record",
        snippet: compact(item.plaintext, terms),
        url: item.stream_url || null,
      });
  }
  if (db)
    for (const term of terms.sort(
      (a, b) => String(b).length - String(a).length,
    )) {
      if (String(term).length < 4) continue;
      const cue = db
        .prepare(
          "SELECT video_id,start_seconds,text FROM yt_transcript_cues WHERE lower(text) LIKE ? ORDER BY start_seconds LIMIT 1",
        )
        .get(`%${String(term).toLowerCase()}%`);
      if (cue) {
        output.push({
          kind: "video",
          title: "Public meeting video",
          snippet: compact(cue.text, terms),
          videoId: cue.video_id,
          startSeconds: Number(cue.start_seconds || 0),
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(cue.video_id)}&t=${Math.floor(Number(cue.start_seconds || 0))}s`,
        });
        break;
      }
    }
  return output;
}

export function nearAddresses(db, query, requestedLimit = 8) {
  const q = String(query || "").trim();
  const limit = Math.min(
    8,
    Math.max(1, Number.parseInt(String(requestedLimit), 10) || 8),
  );
  if (!db || q.length < 2) return { addresses: [] };
  const find = db.prepare(
    "SELECT DISTINCT local_address FROM parcels WHERE local_address IS NOT NULL AND local_address <> '' AND lower(local_address) LIKE lower(?) || '%' ORDER BY local_address LIMIT ?",
  );
  const prefix = find.all(q, limit).map((item) => item.local_address);
  if (prefix.length >= limit) return { addresses: prefix };
  const contains = db
    .prepare(
      "SELECT DISTINCT local_address FROM parcels WHERE local_address IS NOT NULL AND local_address <> '' AND lower(local_address) LIKE '%' || lower(?) || '%' ORDER BY local_address LIMIT ?",
    )
    .all(q, limit)
    .map((item) => item.local_address);
  return { addresses: [...new Set([...prefix, ...contains])].slice(0, limit) };
}

export async function nearFeed(driver, db, address) {
  const requested = String(address || "").trim();
  const exact =
    db && requested
      ? db
          .prepare(
            "SELECT parcel_no,local_address,geometry_geojson FROM parcels WHERE local_address = ? COLLATE NOCASE LIMIT 1",
          )
          .get(requested)
      : null;
  const parcel =
    exact ||
    (db && requested
      ? db
          .prepare(
            "SELECT parcel_no,local_address,geometry_geojson FROM parcels WHERE local_address LIKE ? COLLATE NOCASE ORDER BY length(local_address) LIMIT 1",
          )
          .get(`${requested}%`)
      : null);
  const residentCentroid = centroid(parcel?.geometry_geojson);
  const session = driver.session();
  try {
    const citywideRows = (
      await session.run(
        `MATCH (c:Case) WHERE (${homeLandUse}) AND (${homeDecided}) OPTIONAL MATCH (c)-[:HEARD_AT]->(m:Meeting) OPTIONAL MATCH (c)-[:CONCERNS]->(p:Parcel) OPTIONAL MATCH (s:OpenEntity:Sentiment) WHERE s.source_id=c.source_id RETURN c.case_number AS case_number,c.title AS title,c.request AS request,c.status AS status,max(m.date) AS date,collect(DISTINCT p.parcel_no)[0] AS parcel_no,count(DISTINCT s) > 0 AS opposition ORDER BY date DESC, c.case_number DESC LIMIT 80`,
      )
    ).records.map(row);
    const citywide = dedupeCases(citywideRows)
      .slice(0, CITYWIDE_LIMIT)
      .map((item) =>
        caseItem(item, {
          why_line: `${item.status ? statusVerb(item.status) : "Decision recorded"}${item.parcel_no ? " · parcel in Fishers" : ""}`,
        }),
      );
    if (!parcel || !residentCentroid)
      return {
        address: requested,
        resolved: false,
        parcel: null,
        nearby: [],
        citywide,
        message:
          "We couldn’t match that address to a Fishers parcel. Try selecting an address from the suggestions.",
      };
    const concernRows = (
      await session.run(
        `MATCH (c:Case)-[:CONCERNS]->(p:Parcel) WHERE (${homeLandUse}) AND NOT (${homeDecided}) OPTIONAL MATCH (s:OpenEntity:Sentiment) WHERE s.source_id=c.source_id RETURN c.case_number AS case_number,c.title AS title,c.request AS request,c.status AS status,p.parcel_no AS parcel_no,count(DISTINCT s) > 0 AS opposition`,
      )
    ).records.map(row);
    const geometryFor = db.prepare(
      "SELECT local_address,geometry_geojson FROM parcels WHERE parcel_no=? LIMIT 1",
    );
    const nearby = dedupeCases(
      concernRows
        .map((item) => {
          const caseParcel = item.parcel_no
            ? geometryFor.get(item.parcel_no)
            : null;
          const caseCentroid = centroid(caseParcel?.geometry_geojson);
          return caseCentroid
            ? {
                ...item,
                case_address: caseParcel.local_address,
                distance: distanceMiles(residentCentroid, caseCentroid),
              }
            : null;
        })
        .filter(Boolean),
    )
      .filter((item) => item.distance <= 2)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)
      .map((item) =>
        caseItem(item, {
          distance_mi: Number(item.distance.toFixed(1)),
          why_line: `${item.distance.toFixed(1)} mi from your home${item.case_address ? ` · land-use case at ${item.case_address}` : ""}`,
        }),
      );
    return {
      address: requested,
      resolved: true,
      parcel: {
        parcel_no: parcel.parcel_no,
        local_address: parcel.local_address,
      },
      nearby,
      citywide,
      message: nearby.length
        ? null
        : "No active land-use cases within 2 miles of your home right now.",
    };
  } finally {
    await session.close();
  }
}

export function cachedNearFeed(
  db,
  address,
  mappedCases = [],
  casePayloads = [],
) {
  const requested = String(address || "").trim();
  const exact =
    db && requested
      ? db
          .prepare(
            "SELECT parcel_no,local_address,geometry_geojson FROM parcels WHERE local_address = ? COLLATE NOCASE LIMIT 1",
          )
          .get(requested)
      : null;
  const parcel =
    exact ||
    (db && requested
      ? db
          .prepare(
            "SELECT parcel_no,local_address,geometry_geojson FROM parcels WHERE local_address LIKE ? COLLATE NOCASE ORDER BY length(local_address) LIMIT 1",
          )
          .get(`${requested}%`)
      : null);
  const residentCentroid = centroid(parcel?.geometry_geojson);
  const payloadByCase = new Map(
    casePayloads
      .filter((item) => item?.case_number)
      .map((item) => [norm(item.case_number), item]),
  );
  const rows = dedupeCases(
    (Array.isArray(mappedCases) ? mappedCases : []).map((item) => {
      const detail = payloadByCase.get(norm(item.case_number));
      return {
        ...item,
        title: detail?.title || item.headline,
        status: detail?.status || item.status,
        request: detail?.facts?.request,
        opposition: Boolean(detail?.facts?.opposition?.length),
      };
    }),
  );
  const citywide = rows
    .filter((item) => outcome(item.status) !== "PENDING")
    .sort((a, b) =>
      String(b.case_number).localeCompare(String(a.case_number), undefined, {
        numeric: true,
      }),
    )
    .slice(0, CITYWIDE_LIMIT)
    .map((item) =>
      caseItem(item, {
        why_line: `${statusVerb(item.status)} · cached public-record case`,
      }),
    );
  if (!parcel || !residentCentroid)
    return {
      address: requested,
      resolved: false,
      parcel: null,
      nearby: [],
      citywide,
      message:
        "We couldn’t match that address to a Fishers parcel. Try selecting an address from the suggestions.",
    };
  const nearby = rows
    .map((item) => {
      const point =
        Number.isFinite(item.lat) && Number.isFinite(item.lng)
          ? { lat: item.lat, lon: item.lng }
          : null;
      return point
        ? { ...item, distance: distanceMiles(residentCentroid, point) }
        : null;
    })
    .filter(Boolean)
    .filter((item) => item.distance <= 2 && outcome(item.status) === "PENDING")
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .map((item) =>
      caseItem(item, {
        distance_mi: Number(item.distance.toFixed(1)),
        why_line: `${item.distance.toFixed(1)} mi from your home${item.address ? ` · land-use case at ${item.address}` : ""}`,
      }),
    );
  return {
    address: requested,
    resolved: true,
    parcel: {
      parcel_no: parcel.parcel_no,
      local_address: parcel.local_address,
    },
    nearby,
    citywide,
    message: nearby.length
      ? null
      : "No active land-use cases within 2 miles of your home right now.",
  };
}

export async function landUseCaseNumbers(driver) {
  if (!driver) return [];
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (c:Case) WHERE c.case_number IS NOT NULL RETURN DISTINCT c.case_number AS case_number",
    );
    return [
      ...new Set(
        result.records
          .map((record) => String(record.get("case_number") || "").trim())
          .filter((caseNumber) =>
            /^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?\d/i.test(caseNumber),
          ),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } finally {
    await session.close();
  }
}

export async function nearCase(driver, db, caseNumber) {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (c:Case {case_number:$case}) OPTIONAL MATCH (app)-[:APPLICANT_FOR]->(c) OPTIONAL MATCH (att:Person)-[:REPRESENTS]->(app) OPTIONAL MATCH (c)-[:CONCERNS]->(p:Parcel) OPTIONAL MATCH (c)-[:REZONE_FROM]->(f:ZoningDistrict) OPTIONAL MATCH (c)-[:REZONE_TO]->(t:ZoningDistrict) OPTIONAL MATCH (c)-[:HEARD_AT]->(m:Meeting) OPTIONAL MATCH (s:OpenEntity:Sentiment) WHERE s.source_id=c.source_id RETURN c.case_number AS case_number,c.title AS title,c.status AS status,c.vote_ayes AS vote_ayes,c.vote_nays AS vote_nays,c.case_type AS case_type,collect(DISTINCT app.name) AS applicants,collect(DISTINCT att.name) AS attorneys,collect(DISTINCT p.address) AS parcels,collect(DISTINCT f.code) AS rezone_from,collect(DISTINCT t.code) AS rezone_to,collect(DISTINCT coalesce(s.name,s.text,s.sentiment)) AS opposition,collect(DISTINCT m.board)[0] AS board,collect(DISTINCT m.date)[0] AS meeting_date",
      { case: caseNumber },
    );
    const detail = result.records[0] ? row(result.records[0]) : null;
    if (!detail)
      return { error: "case_not_found", case_number: caseNumber, receipts: [] };
    detail.applicants = uniqueNames(detail.applicants || []);
    detail.attorneys = uniqueNames(detail.attorneys || []);
    detail.parcels = uniqueNames(detail.parcels || []);
    detail.opposition = uniqueNames(detail.opposition || []);
    const track = async (names, relation) => {
      const out = [];
      const pattern =
        relation === "REPRESENTS"
          ? "(x)-[:REPRESENTS]->()-[:APPLICANT_FOR]->(c:Case)"
          : "(x)-[:APPLICANT_FOR]->(c:Case)";
      for (const name of names.slice(0, 2)) {
        const r = await session.run(
          `MATCH ${pattern} WHERE x.name=$name AND (${landUse}) RETURN DISTINCT c.case_number AS case_number,c.status AS status`,
          { name },
        );
        const cases = r.records.map(row);
        const decidedCases = cases.filter((x) =>
          /approv|den|withdraw|table|continu/i.test(String(x.status)),
        );
        out.push({
          name,
          cases: new Set(cases.map((x) => x.case_number)).size,
          approved: decidedCases.filter((x) => /approv/i.test(String(x.status)))
            .length,
          decided: new Set(decidedCases.map((x) => x.case_number)).size,
        });
      }
      return out;
    };
    const applicants = await track(detail.applicants, "APPLICANT_FOR");
    const attorneys = await track(detail.attorneys, "REPRESENTS");
    const docs = (
      await session.run(
        "MATCH (c:Case {case_number:$case})-[:EVIDENCED_BY|HAS_DOCUMENT]->(d:Document) RETURN DISTINCT c.case_number AS case_number,d.doc_id AS doc_id,d.source_id AS source_id,d.title AS title,d.url AS url LIMIT 8",
        { case: caseNumber },
      )
    ).records.map(row);
    const terms = [
      detail.case_number,
      detail.title,
      ...detail.applicants,
      ...detail.parcels,
    ].filter(Boolean);
    const receiptList = receipts(db, docs, terms);
    const video = receiptList.find((x) => x.kind === "video");
    const narrativeFacts = {
      ...detail,
      applicants,
      attorneys,
      case_numbers: [detail.case_number],
    };
    const languageTask = narrate(
      narrativeFacts,
      "Return {what_it_is,did_they_listen,drafted_comment,what_to_say}. Phrase only facts. drafted_comment is a respectful first-person public comment around 120 words. Every field must cite the supplied case_number; what_to_say is an array of 2-4 short factual bullets.",
    ).catch(() => ({}));
    // Prediction and prose use separate facts, so run their model calls together.
    const [prediction, language] = await Promise.all([
      predict(driver, {
        case: detail.case_number,
        applicant: detail.applicants[0] || null,
        opposition_count: detail.opposition.length,
      }),
      languageTask,
    ]);
    const facts = {
      ...narrativeFacts,
      prediction: {
        approval_rate: prediction.approval_rate,
        approved: prediction.approved,
        total: prediction.total,
        precedent_case_numbers: prediction.precedent_case_numbers || [],
      },
      case_numbers: [
        detail.case_number,
        ...(prediction.precedent_case_numbers || []),
      ],
    };
    const vote =
      detail.vote_ayes == null && detail.vote_nays == null
        ? "Vote not recorded"
        : `${detail.vote_ayes || 0}-${detail.vote_nays || 0}`;
    const trackText = (person, role) =>
      !person
        ? ""
        : person.decided
          ? `${role} ${person.name}: ${person.approved} of ${person.decided} decided cases approved`
          : `${role} ${person.name}: ${person.cases} prior case${person.cases === 1 ? "" : "s"} (outcomes still pending)`;
    const behindIt =
      [
        trackText(applicants[0], "Applicant"),
        trackText(attorneys[0], "Attorney"),
      ]
        .filter(Boolean)
        .join("; ") || "Applicant track record is not available";
    return {
      case_number: detail.case_number,
      title: detail.title || detail.case_type || "Fishers land-use case",
      status: outcome(detail.status),
      facts,
      sections: {
        what_it_is: cite(
          language.what_it_is ||
            `${detail.case_number} concerns ${detail.title || detail.case_type || "a land-use request"}${detail.parcels[0] ? ` at ${detail.parcels[0]}` : ""}.`,
          detail.case_number,
        ),
        behind_it: cite(behindIt, detail.case_number),
        did_they_listen: cite(
          language.did_they_listen ||
            `${detail.opposition.length} linked public-comment signal${detail.opposition.length === 1 ? "" : "s"}; outcome: ${outcome(detail.status)}. Vote: ${vote}.`,
          detail.case_number,
        ),
        odds: cite(
          `Comparable decisions were approved ${prediction.approval_rate}% of the time (${prediction.approved}/${prediction.total}).`,
          detail.case_number,
        ),
        drafted_comment: cite(
          language.drafted_comment || fallbackComment(detail),
          detail.case_number,
        ),
        what_to_say: (Array.isArray(language.what_to_say) &&
        language.what_to_say.length
          ? language.what_to_say
          : [
              `Ask for findings on ${detail.case_number}.`,
              "Ask the board to address the public-record concerns.",
              "Ask that your comment be included in the public file.",
            ]
        ).map((item) => cite(item, detail.case_number)),
      },
      meeting: {
        board: detail.board || null,
        date: detail.meeting_date || null,
      },
      vote: {
        ayes: detail.vote_ayes ?? null,
        nays: detail.vote_nays ?? null,
        text: vote,
      },
      receipts: receiptList,
      video_receipt: video || null,
      prediction,
    };
  } finally {
    await session.close();
  }
}
