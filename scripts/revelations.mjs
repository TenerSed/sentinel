import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readCache, writeCache } from "../server/cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new Database(path.join(root, "data", "fishers.db"), {
  fileMustExist: true,
});
db.pragma("journal_mode = WAL");

const LAND_USE_CASE = /^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?\d/i;
const CASE_TOKEN = /\b(?:RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)[\s-]*\d+(?:[\s-]+\d+)?\b/gi;
const COMMON_NAME_WORDS = new Set([
  "city",
  "companies",
  "company",
  "development",
  "fishers",
  "group",
  "health",
  "homes",
  "inc",
  "indianapolis",
  "llc",
  "lawrence",
  "noblesville",
  "properties",
  "property",
  "school",
  "westfield",
]);
const STREET_SUFFIXES = new Set([
  "avenue",
  "ave",
  "boulevard",
  "blvd",
  "circle",
  "court",
  "ct",
  "drive",
  "dr",
  "highway",
  "hwy",
  "lane",
  "ln",
  "parkway",
  "pkwy",
  "road",
  "rd",
  "street",
  "st",
  "trace",
  "trail",
  "way",
]);
const themes = [
  { key: "neighbor", label: "Neighbor", pattern: /\bneighbou?rs?(?:hoods?)?\b/i },
  { key: "traffic", label: "Traffic", pattern: /\btraffic\b/i },
  { key: "drainage_stormwater", label: "Drainage / stormwater", pattern: /\b(?:drainage|storm\s*water)\b/i },
  { key: "density", label: "Density", pattern: /\bdensit(?:y|ies)\b/i },
  { key: "school", label: "School", pattern: /\bschools?\b/i },
  { key: "safety", label: "Safety", pattern: /\bsafety\b/i },
  { key: "oppose_opposition", label: "Oppose / opposition", pattern: /\b(?:oppos(?:e[ds]?|ing|ition|itional)?|opponents?)\b/i },
  { key: "variance", label: "Variance", pattern: /\bvariances?\b/i },
  { key: "rezone", label: "Rezone", pattern: /\brezon(?:e[ds]?|ing)\b/i },
  { key: "sidewalk", label: "Sidewalk", pattern: /\bsidewalks?\b/i },
  { key: "tree_landscape", label: "Tree / landscape", pattern: /\b(?:trees?|landscap(?:e[ds]?|ing))\b/i },
  { key: "parking", label: "Parking", pattern: /\bparking\b/i },
];

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (value) => clean(value).toLowerCase().match(/[a-z0-9]+/g) || [];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPhrase = (value) =>
  new RegExp(`\\b${words(value).map(escapeRegex).join("\\s+")}\\b`, "i");

function caseTerms(caseNumber) {
  const found = clean(caseNumber).match(CASE_TOKEN) || [];
  return [...new Set([caseNumber, ...found].map(clean).filter((term) => normalized(term).length >= 4))]
    .map((term) => new RegExp(`\\b${escapeRegex(term).replace(/[-\s]+/g, "[\\s-]*")}\\b`, "i"));
}

function addressTerms(payload) {
  const parcels = Array.isArray(payload.facts?.parcels) ? payload.facts.parcels : [];
  const output = [];
  for (const parcel of parcels) {
    const first = clean(parcel).split(",", 1)[0];
    const tokens = words(first);
    const street = tokens.filter(
      (token) =>
        !/^\d+$/.test(token) &&
        !/^\d+(?:st|nd|rd|th)$/.test(token) &&
        token !== "and" &&
        !["east", "west", "north", "south", "e", "w", "n", "s"].includes(token) &&
        token !== "unit",
    );
    const streetName = street.filter((token) => !STREET_SUFFIXES.has(token));
    if (/^\d+\s+/.test(first)) output.push(first);
    if (streetName.length && street.join(" ").length >= 4) output.push(street.join(" "));
    if (streetName.length >= 2) output.push(streetName.join(" "));
  }
  return [...new Map(output.map((term) => [normalized(term), term])).values()]
    .filter((term) => words(term).length > 1 || term.length >= 6)
    .map((term) => ({ term, pattern: wordPhrase(term) }));
}

function surnameTerms(payload) {
  const records = [
    ...(Array.isArray(payload.facts?.applicants) ? payload.facts.applicants : []),
    ...(Array.isArray(payload.facts?.attorneys) ? payload.facts.attorneys : []),
  ];
  const surnames = records.flatMap((record) => {
    const name = clean(typeof record === "string" ? record : record?.name);
    const tokens = words(name).filter((token) => !["the", "of"].includes(token));
    if (tokens.length < 2 || /\b(?:llc|inc|city of|school|company|companies|development|properties|homes|health)\b/i.test(name)) return [];
    const surname = tokens.at(-1);
    return surname && surname.length >= 4 && !COMMON_NAME_WORDS.has(surname) ? [surname] : [];
  });
  return [...new Set(surnames)].map((term) => ({ term, pattern: wordPhrase(term) }));
}

function quoteText(cues) {
  const unique = [];
  for (const cue of cues) {
    const text = clean(cue.text)
      .replace(/^[,.;:!?-]+\s*/, "")
      .replace(/[,:;-]+$/, "");
    if (text && normalized(text) !== normalized(unique.at(-1))) unique.push(text);
  }
  return unique.slice(0, 5).map((text) => /[.!?]$/.test(text) ? text : `${text}.`).join(" ");
}

function quotesForCase(payload, cuesByVideo) {
  const numberTerms = caseTerms(payload.case_number);
  const addresses = addressTerms(payload);
  const surnames = surnameTerms(payload);
  const hits = [];
  for (const [videoId, cues] of cuesByVideo) {
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index];
      let matchedOn = null;
      if (numberTerms.some((pattern) => pattern.test(cue.text))) matchedOn = "case number";
      else if (addresses.some(({ pattern }) => pattern.test(cue.text))) matchedOn = "address";
      else if (surnames.some(({ pattern }) => pattern.test(cue.text))) matchedOn = "applicant";
      if (matchedOn) hits.push({ videoId, index, cue, matchedOn });
    }
  }
  const groups = [];
  for (const hit of hits) {
    const previous = groups.at(-1);
    if (
      previous &&
      previous.videoId === hit.videoId &&
      hit.cue.start_seconds - previous.lastSeconds <= 30
    ) {
      previous.hits.push(hit);
      previous.lastSeconds = hit.cue.start_seconds;
      if (hit.matchedOn === "case number" || (hit.matchedOn === "address" && previous.matchedOn === "applicant")) previous.matchedOn = hit.matchedOn;
    } else {
      groups.push({
        videoId: hit.videoId,
        hits: [hit],
        firstSeconds: hit.cue.start_seconds,
        lastSeconds: hit.cue.start_seconds,
        matchedOn: hit.matchedOn,
        eventTime: hit.cue.event_time || "",
      });
    }
  }
  const candidates = groups
    .map((group) => {
      const videoCues = cuesByVideo.get(group.videoId);
      const firstIndex = group.hits[0].index;
      const lastIndex = group.hits.at(-1).index;
      let start = Math.max(0, firstIndex - 1);
      let end = Math.min(videoCues.length, Math.max(lastIndex + 2, start + 2));
      if (end - start > 5) end = start + 5;
      if (end - start < 2 && start > 0) start -= 1;
      const startSeconds = Math.floor(Number(videoCues[start]?.start_seconds ?? group.firstSeconds));
      return {
        video_id: group.videoId,
        start_seconds: startSeconds,
        text: quoteText(videoCues.slice(start, end)),
        matched_on: group.matchedOn,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(group.videoId)}&t=${startSeconds}s`,
        _event_time: group.eventTime,
      };
    })
    .filter((quote) => quote.text.length >= 24)
    .sort((a, b) => a._event_time.localeCompare(b._event_time) || a.video_id.localeCompare(b.video_id) || a.start_seconds - b.start_seconds);
  const priority = { "case number": 0, address: 1, applicant: 2 };
  return candidates
    .map((quote, order) => ({ ...quote, _order: order }))
    .sort((a, b) => priority[a.matched_on] - priority[b.matched_on] || a._order - b._order)
    .slice(0, 12)
    .sort((a, b) => a._order - b._order)
    .map(({ _event_time, _order, ...quote }) => quote);
}

const cueRows = db.prepare(`
  SELECT c.video_id,c.start_seconds,c.text,c.sort_order,
         coalesce(e.start_datetime,e.event_date,'') AS event_time
  FROM yt_transcript_cues c
  LEFT JOIN yt_transcripts t ON t.video_id=c.video_id
  LEFT JOIN cc_events e ON e.event_id=t.event_id
  ORDER BY event_time,c.video_id,c.sort_order
`).all();
const cuesByVideo = new Map();
for (const cue of cueRows) {
  if (!cuesByVideo.has(cue.video_id)) cuesByVideo.set(cue.video_id, []);
  cuesByVideo.get(cue.video_id).push(cue);
}

const caseRows = db.prepare("SELECT key,payload FROM app_cache WHERE key LIKE 'case:%' ORDER BY key").all()
  .map((row) => ({ key: row.key, payload: JSON.parse(row.payload) }))
  .filter(({ payload }) => LAND_USE_CASE.test(clean(payload.case_number)));
const themeCounts = themes.map((theme) => ({
  key: theme.key,
  label: theme.label,
  count: cueRows.reduce((count, cue) => count + (theme.pattern.test(cue.text) ? 1 : 0), 0),
})).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
const outcomes = ["APPROVED", "DENIED", "WITHDRAWN", "TABLED"].map((label) => ({
  label: label.charAt(0) + label.slice(1).toLowerCase(),
  count: caseRows.filter(({ payload }) => payload.status === label).length,
}));
const decided = outcomes.reduce((sum, item) => sum + item.count, 0);
const caseTypes = ["RZ", "PUD", "VA", "SE", "ANX", "TA"].map((label) => ({
  label,
  count: caseRows.filter(({ payload }) => clean(payload.case_number).match(/^([A-Z]+)/i)?.[1]?.toUpperCase() === label).length,
}));
const sourceStats = {
  meetings: Number(db.prepare("SELECT count(*) AS count FROM cc_events").get().count),
  documents: Number(db.prepare("SELECT count(*) AS count FROM cc_files WHERE has_plaintext=1 AND length(trim(plaintext))>0").get().count),
  document_characters: Number(db.prepare("SELECT sum(length(plaintext)) AS count FROM cc_files WHERE has_plaintext=1 AND length(trim(plaintext))>0").get().count),
  videos: Number(db.prepare("SELECT count(DISTINCT video_id) AS count FROM yt_transcript_cues").get().count),
  transcript_cues: cueRows.length,
  transcript_characters: Number(db.prepare("SELECT sum(length(text)) AS count FROM yt_transcript_cues").get().count),
  parcels: Number(db.prepare("SELECT count(*) AS count FROM parcels").get().count),
  cases: caseRows.length,
  decisions: decided,
};
const corpus = {
  source_counts: sourceStats,
  themes: themeCounts,
  outcomes: {
    counts: outcomes,
    decided,
    approval_percentage: decided ? Math.round((outcomes[0].count / decided) * 100) : 0,
  },
  case_types: caseTypes,
  methodology: "Theme totals count transcript cues containing the displayed word or listed variant; each cue counts at most once per theme. Outcomes and case types come from the 63 cached land-use case records.",
};

let casesWithQuotes = 0;
let quoteCount = 0;
const transaction = db.transaction(() => {
  for (const { key, payload } of caseRows) {
    const quotes = quotesForCase(payload, cuesByVideo);
    if (quotes.length) casesWithQuotes += 1;
    quoteCount += quotes.length;
    writeCache(db, key, { ...payload, quotes });
  }
  writeCache(db, "insights:corpus", corpus);
  writeCache(db, "stats", { ...(readCache(db, "stats") || {}), ...sourceStats });
});
transaction();

console.log(JSON.stringify({
  cases: caseRows.length,
  cases_with_quotes: casesWithQuotes,
  quotes: quoteCount,
  themes: themeCounts,
  stats: sourceStats,
}, null, 2));
db.close();
