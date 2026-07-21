import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "lamplighter.db");
const REQUEST_TIMEOUT_MS = 6_000;
const LLM_TIMEOUT_MS = 15_000;
const MAX_CANDIDATES = 6;
const MAX_ARCGIS_SERVICES = 4;

const cleanText = (value, max = 120) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 60);
const unique = (values) => [...new Set(values.filter(Boolean))];
const failureReason = (error) =>
  error?.name === "AbortError"
    ? "Timed out before the endpoint responded."
    : cleanText(error?.message || "The endpoint could not be reached.", 220);

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Lamplighter civic source verifier/1.0",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { response, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function deterministicProposal(city, state) {
  const citySlug = slugify(city);
  const stateSlug = slugify(state);
  const countyByCity = {
    "carmel:IN": "Hamilton County Indiana",
    "fishers:IN": "Hamilton County Indiana",
    "san jose:CA": "Santa Clara County",
    "mountain view:CA": "Santa Clara County",
  };
  const county = countyByCity[`${city.toLowerCase()}:${state}`] || "";
  return {
    civicclerkSlugs: unique([
      `${citySlug}${stateSlug}`,
      citySlug,
      `cityof${citySlug}`,
      `${citySlug}${stateSlug === "ca" ? "ca" : stateSlug}`,
    ]),
    legistarSlugs: unique([
      citySlug,
      `${citySlug}${stateSlug}`,
      `cityof${citySlug}`,
      stateSlug === "ca" ? `${citySlug}ca` : "",
    ]),
    county,
    arcgisQuery: `parcels ${county || `${city} ${state}`}`,
  };
}

function validProposal(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const civic = Array.isArray(value.civicclerkSlugs)
    ? value.civicclerkSlugs.map(slugify)
    : [];
  const legistar = Array.isArray(value.legistarSlugs)
    ? value.legistarSlugs.map(slugify)
    : [];
  return {
    civicclerkSlugs: unique([...civic, ...fallback.civicclerkSlugs]).slice(
      0,
      MAX_CANDIDATES,
    ),
    legistarSlugs: unique([...legistar, ...fallback.legistarSlugs]).slice(
      0,
      MAX_CANDIDATES,
    ),
    county: cleanText(value.county, 100) || fallback.county,
    arcgisQuery:
      fallback.county && /county/i.test(fallback.county)
        ? fallback.arcgisQuery
        : cleanText(value.arcgisQuery, 180) || fallback.arcgisQuery,
  };
}

async function proposeCandidates(city, state) {
  const fallback = deterministicProposal(city, state);
  if (!process.env.OPENROUTER_API_KEY)
    return {
      proposal: fallback,
      mode: "deterministic fallback",
      reason: "OPENROUTER_API_KEY is not configured; safe deterministic guesses were used.",
    };
  const prompt = `Propose civic data identifiers for ${city}, ${state}. Return strict JSON only with exactly these keys: {"civicclerkSlugs":["slug"],"legistarSlugs":["slug"],"county":"County name and state","arcgisQuery":"parcels search query"}. Slugs must be lowercase letters/numbers only. Give at most 3 likely slugs per vendor. This is proposal only; code will verify every endpoint.`;
  try {
    const { response, body, text } = await fetchJson(
      "https://openrouter.ai/api/v1/chat/completions",
      LLM_TIMEOUT_MS,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/local/sentinel",
          "x-title": "Lamplighter City Onboarding",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
          reasoning: { enabled: false },
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You propose identifiers only. Never claim an endpoint works. Respond with JSON only.",
            },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    if (!response.ok)
      throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    const content = body?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(
      String(content || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
    return {
      proposal: validProposal(parsed, fallback),
      mode: "OpenRouter proposal",
      reason: "One OpenRouter call proposed candidates; none were trusted until probed by code.",
    };
  } catch (error) {
    return {
      proposal: fallback,
      mode: "deterministic fallback",
      reason: `The proposal call failed (${failureReason(error)}); safe deterministic guesses were used.`,
    };
  }
}

async function probeVendor(vendor, slug) {
  const url =
    vendor === "civicclerk"
      ? `https://${slug}.api.civicclerk.com/v1/Events?%24top=1`
      : `https://webapi.legistar.com/v1/${slug}/events?%24top=1`;
  const attempt = { kind: "meetings", vendor, slug, url, verified: false };
  try {
    const { response, body } = await fetchJson(url);
    attempt.status = response.status;
    const rows = vendor === "civicclerk" ? body?.value : body;
    if (!response.ok) {
      attempt.reason = `HTTP ${response.status}; the endpoint did not pass verification.`;
      return attempt;
    }
    if (!Array.isArray(rows)) {
      attempt.reason = "HTTP 200, but the response was not the vendor's expected event list.";
      return attempt;
    }
    if (!rows.length) {
      attempt.reason = "HTTP 200, but the first page contained no sample event.";
      return attempt;
    }
    const sample =
      vendor === "civicclerk"
        ? rows[0]?.eventName || rows[0]?.categoryName
        : rows[0]?.EventBodyName || rows[0]?.EventComment;
    if (!cleanText(sample)) {
      attempt.reason = "HTTP 200, but no event name was present to prove the response shape.";
      return attempt;
    }
    return {
      ...attempt,
      verified: true,
      evidence: {
        status: response.status,
        sample: cleanText(sample, 180),
        firstPageRecords: rows.length,
      },
    };
  } catch (error) {
    return { ...attempt, status: null, reason: failureReason(error) };
  }
}

async function discoverArcgis(query) {
  const searchUrl = `https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(query)}&f=json&num=8`;
  const searchAttempt = {
    kind: "parcels",
    vendor: "arcgis",
    url: searchUrl,
    verified: false,
  };
  try {
    const { response, body } = await fetchJson(searchUrl);
    searchAttempt.status = response.status;
    if (!response.ok || !Array.isArray(body?.results)) {
      searchAttempt.reason = response.ok
        ? "The search response did not include an ArcGIS results list."
        : `HTTP ${response.status}; ArcGIS search did not respond successfully.`;
      return { searchAttempt, serviceAttempts: [] };
    }
    const seenServiceUrls = new Set();
    const candidates = body.results
      .filter((item) => {
        const serviceUrl = String(item?.url || "").replace(/\/$/, "");
        const relevant =
          item?.type === "Feature Service" &&
          serviceUrl &&
          /(parcel|property|cadastr|tax\s*lot|assessor)/i.test(
            String(item?.title || ""),
          ) &&
          !seenServiceUrls.has(serviceUrl);
        if (relevant) seenServiceUrls.add(serviceUrl);
        return relevant;
      })
      .slice(0, MAX_ARCGIS_SERVICES);
    searchAttempt.verified = true;
    searchAttempt.evidence = {
      status: response.status,
      sample: `${body.total ?? body.results.length} search results; ${candidates.length} Feature Services selected for verification`,
      firstPageRecords: body.results.length,
    };
    const serviceAttempts = await Promise.all(
      candidates.map(async (item) => {
        const serviceUrl = String(item.url).replace(/\/$/, "");
        const probeUrl = `${serviceUrl}?f=json`;
        const attempt = {
          kind: "parcels",
          vendor: "arcgis",
          url: serviceUrl,
          probeUrl,
          verified: false,
        };
        try {
          const { response: serviceResponse, body: service } =
            await fetchJson(probeUrl);
          attempt.status = serviceResponse.status;
          const realService =
            serviceResponse.ok &&
            service &&
            !service.error &&
            (Array.isArray(service.layers) || service.type === "Feature Layer");
          if (!realService) {
            attempt.reason = serviceResponse.ok
              ? cleanText(service?.error?.message, 180) ||
                "HTTP 200, but the payload was not an ArcGIS feature service description."
              : `HTTP ${serviceResponse.status}; the feature service did not respond successfully.`;
            return attempt;
          }
          const firstLayer = service.layers?.[0];
          return {
            ...attempt,
            verified: true,
            name: cleanText(service.serviceDescription || item.title || firstLayer?.name, 180),
            evidence: {
              status: serviceResponse.status,
              sample: cleanText(firstLayer?.name || item.title || "Feature service", 180),
              geometryType: cleanText(service.geometryType || firstLayer?.geometryType, 80) || null,
              layerCount: Array.isArray(service.layers) ? service.layers.length : 1,
            },
          };
        } catch (error) {
          return { ...attempt, status: null, reason: failureReason(error) };
        }
      }),
    );
    return { searchAttempt, serviceAttempts };
  } catch (error) {
    return {
      searchAttempt: {
        ...searchAttempt,
        status: null,
        reason: failureReason(error),
      },
      serviceAttempts: [],
    };
  }
}

export async function discoverCity(cityValue, stateValue) {
  const city = cleanText(cityValue, 80);
  const state = cleanText(stateValue, 2).toUpperCase();
  if (!city || !/^[A-Z]{2}$/.test(state))
    throw Object.assign(new Error("Enter a city and two-letter US state code."), {
      status: 400,
      code: "invalid_location",
    });

  const proposed = await proposeCandidates(city, state);
  const [civicAttempts, legistarAttempts, arcgis] = await Promise.all([
    Promise.all(
      proposed.proposal.civicclerkSlugs.map((slug) =>
        probeVendor("civicclerk", slug),
      ),
    ),
    Promise.all(
      proposed.proposal.legistarSlugs.map((slug) =>
        probeVendor("legistar", slug),
      ),
    ),
    discoverArcgis(proposed.proposal.arcgisQuery),
  ]);
  const vendorAttempts = [...civicAttempts, ...legistarAttempts];
  const verifiedMeetings = vendorAttempts.filter((item) => item.verified);
  const verifiedParcels = arcgis.serviceAttempts.filter((item) => item.verified);
  const meetingsIngested = verifiedMeetings[0]
    ? cityMeetingStatus(city, verifiedMeetings[0].vendor, verifiedMeetings[0].slug).meetingsIngested
    : 0;
  const sources = [
    ...verifiedMeetings.map((item) => ({
      kind: "meetings",
      vendor: item.vendor,
      slug: item.slug,
      url: item.url,
      verified: true,
      evidence: item.evidence,
    })),
    ...verifiedParcels.map((item) => ({
      kind: "parcels",
      vendor: "arcgis",
      url: item.url,
      verified: true,
      evidence: item.evidence,
    })),
  ];
  const attempts = [
    ...vendorAttempts,
    arcgis.searchAttempt,
    ...arcgis.serviceAttempts,
    {
      kind: "video",
      vendor: "youtube",
      url: null,
      status: null,
      verified: false,
      reason: "Optional video discovery was skipped to keep live onboarding fast.",
    },
  ];
  const step = (id, label, ok, detail) => ({
    id,
    label,
    status: ok ? "verified" : "not_found",
    detail,
  });
  return {
    city,
    state,
    steps: [
      {
        id: "propose",
        label: "Proposing candidate endpoints",
        status: "complete",
        detail: `${proposed.mode}. ${proposed.reason}`,
      },
      step(
        "civicclerk",
        "Verifying CivicClerk tenants",
        civicAttempts.some((item) => item.verified),
        civicAttempts.some((item) => item.verified)
          ? "A CivicClerk event endpoint returned a valid sample."
          : "No proposed CivicClerk tenant passed the live probe.",
      ),
      step(
        "legistar",
        "Verifying Legistar tenants",
        legistarAttempts.some((item) => item.verified),
        legistarAttempts.some((item) => item.verified)
          ? "A Legistar event endpoint returned a valid sample."
          : "No proposed Legistar tenant passed the live probe.",
      ),
      {
        id: "arcgis-search",
        label: "Searching ArcGIS for parcel layers",
        status: arcgis.searchAttempt.verified ? "verified" : "not_found",
        detail: arcgis.searchAttempt.verified
          ? arcgis.searchAttempt.evidence.sample
          : arcgis.searchAttempt.reason,
        url: arcgis.searchAttempt.url,
        evidence: arcgis.searchAttempt.verified
          ? arcgis.searchAttempt.evidence
          : { status: arcgis.searchAttempt.status },
      },
      step(
        "arcgis-verify",
        "Confirming parcel layers respond",
        verifiedParcels.length > 0,
        verifiedParcels.length
          ? `${verifiedParcels.length} live Feature Service${verifiedParcels.length === 1 ? "" : "s"} verified.`
          : "No candidate Feature Service passed the live description probe.",
      ),
      {
        id: "video",
        label: "Checking optional meeting video",
        status: "not_found",
        detail: "Skipped for the fast path; meetings and parcels remain independently verifiable.",
      },
    ],
    sources,
    attempts: attempts.filter((item) => !item.verified),
    ingestible: verifiedMeetings.length > 0,
    meetingsIngested,
  };
}

function meetingDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS onboarded_meetings (
    city TEXT NOT NULL,
    vendor TEXT NOT NULL,
    slug TEXT NOT NULL,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT,
    start_datetime TEXT,
    raw_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (city, vendor, slug, event_id)
  )`);
  return db;
}

async function fetchMeetingPages(vendor, slug) {
  const rows = [];
  let skip = 0;
  for (let page = 0; page < 200; page += 1) {
    const url =
      vendor === "civicclerk"
        ? `https://${slug}.api.civicclerk.com/v1/Events?%24top=50&%24skip=${skip}`
        : `https://webapi.legistar.com/v1/${slug}/events?%24top=1000&%24skip=${skip}`;
    const { response, body } = await fetchJson(url, 10_000);
    if (!response.ok)
      throw Object.assign(
        new Error(`${vendor} returned HTTP ${response.status} while paging meetings.`),
        { status: 502, code: "vendor_http_error" },
      );
    const pageRows = vendor === "civicclerk" ? body?.value : body;
    if (!Array.isArray(pageRows))
      throw Object.assign(new Error(`${vendor} returned an unexpected meeting payload.`), {
        status: 502,
        code: "vendor_payload_error",
      });
    if (!pageRows.length) return rows;
    rows.push(...pageRows);
    skip += pageRows.length;
  }
  throw Object.assign(new Error("Meeting pagination exceeded the safety limit."), {
    status: 502,
    code: "pagination_limit",
  });
}

export async function ingestMeetings(vendorValue, slugValue, cityValue) {
  const vendor = cleanText(vendorValue, 20).toLowerCase();
  const slug = slugify(slugValue);
  const city = cleanText(cityValue, 80);
  if (!city || !slug || !["civicclerk", "legistar"].includes(vendor))
    throw Object.assign(new Error("A valid city, vendor, and slug are required."), {
      status: 400,
      code: "invalid_ingest_request",
    });
  const rows = await fetchMeetingPages(vendor, slug);
  const fetchedAt = new Date().toISOString();
  const normalized = rows
    .map((row) => {
      const eventId = vendor === "civicclerk" ? row?.id : row?.EventId;
      const name =
        vendor === "civicclerk"
          ? row?.eventName || row?.categoryName
          : row?.EventBodyName || row?.EventComment;
      if (eventId == null || !cleanText(name)) return null;
      return {
        city,
        vendor,
        slug,
        event_id: String(eventId),
        name: cleanText(name, 300),
        body: cleanText(
          vendor === "civicclerk"
            ? row?.categoryName || row?.agendaName
            : row?.EventBodyName,
          300,
        ),
        start_datetime: cleanText(
          vendor === "civicclerk"
            ? row?.startDateTime || row?.eventDate
            : row?.EventDate,
          80,
        ),
        raw_json: JSON.stringify(row),
        fetched_at: fetchedAt,
      };
    })
    .filter(Boolean);
  const db = meetingDb();
  try {
    const upsert = db.prepare(`INSERT INTO onboarded_meetings
      (city,vendor,slug,event_id,name,body,start_datetime,raw_json,fetched_at)
      VALUES (@city,@vendor,@slug,@event_id,@name,@body,@start_datetime,@raw_json,@fetched_at)
      ON CONFLICT(city,vendor,slug,event_id) DO UPDATE SET
        name=excluded.name, body=excluded.body, start_datetime=excluded.start_datetime,
        raw_json=excluded.raw_json, fetched_at=excluded.fetched_at`);
    db.transaction((items) => items.forEach((item) => upsert.run(item)))(normalized);
  } finally {
    db.close();
  }
  return {
    city,
    ingested: normalized.length,
    sample: unique(normalized.map((item) => item.name)).slice(0, 3),
  };
}

export function cityMeetingStatus(cityValue, vendorValue, slugValue) {
  const city = cleanText(cityValue, 80);
  const vendor = cleanText(vendorValue, 20).toLowerCase();
  const slug = slugify(slugValue);
  if (!city) return { city, meetingsIngested: 0 };
  const db = meetingDb();
  try {
    const row = vendor && slug
      ? db.prepare("SELECT COUNT(*) AS count FROM onboarded_meetings WHERE city = ? COLLATE NOCASE AND vendor = ? AND slug = ?").get(city, vendor, slug)
      : db.prepare("SELECT COUNT(*) AS count FROM onboarded_meetings WHERE city = ? COLLATE NOCASE").get(city);
    return { city, vendor, slug, meetingsIngested: Number(row?.count || 0) };
  } finally {
    db.close();
  }
}
