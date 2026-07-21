import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureCache, readCache, writeCache } from "./cache.mjs";
import {
  citySlug,
  openCityDb,
  portalUrlFor,
  rebuildCitySummary,
  resolveRuntimeDbPath,
} from "./city.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Canonical runtime database — the same file the HTTP layer serves from.
const dbPath = resolveRuntimeDbPath();
const REQUEST_TIMEOUT_MS = 6_000;
const WEB_SEARCH_TIMEOUT_MS = 40_000;
const MAX_CANDIDATES = 14;
const MAX_LLM_CANDIDATES = 9;
const MAX_ARCGIS_SERVICES = 4;
const KNOWN_VENDORS = [
  "civicclerk", "legistar", "escribe", "primegov", "novusagenda",
  "boarddocs", "granicus", "civicplus", "municode", "iqm2",
];
const LOCATE_TIMEOUT_MS = 4_000;
const STATE_ABBR = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC", "Puerto Rico": "PR",
  Guam: "GU", "American Samoa": "AS", "Northern Mariana Islands": "MP",
  "United States Virgin Islands": "VI",
};
const STATE_NAME = Object.fromEntries(
  Object.entries(STATE_ABBR).map(([name, abbreviation]) => [abbreviation, name]),
);

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
// Re-exported so the streaming discovery route can reuse the exact same
// normalisation the batch route uses (identical candidates, identical probes).
export { cleanText, slugify, unique, MAX_CANDIDATES, STATE_NAME };
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

async function fetchPortal(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "user-agent": "Lamplighter civic source verifier/1.0",
      },
    });
    const text = await response.text();
    const snippet = cleanText(
      text
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'"),
      220,
    );
    return {
      url,
      status: response.status,
      success: response.status >= 200 && response.status < 300,
      snippet:
        snippet ||
        cleanText(response.headers.get("location"), 220) ||
        cleanText(response.headers.get("content-type"), 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

function locateDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureCache(db);
  return db;
}

function stateAbbreviation(state, fallback = "") {
  const normalized = cleanText(state, 80);
  if (STATE_ABBR[normalized]) return STATE_ABBR[normalized];
  const candidate = cleanText(fallback, 12).toUpperCase().replace(/^US-/, "");
  return /^[A-Z]{2}$/.test(candidate) ? candidate : "";
}

function municipalityError() {
  return Object.assign(new Error("No municipality found at this location."), {
    status: 404,
    code: "no_municipality",
  });
}

function normalizeLocatedPlace(place, lat, lng, source) {
  const city = cleanText(place.city, 100);
  const county = cleanText(place.county, 120);
  const state = cleanText(place.state, 80);
  const stateAbbr = stateAbbreviation(state, place.stateAbbr);
  if (!city || !county || !state || !stateAbbr) return null;
  return { city, county, state, stateAbbr, lat, lng, source };
}

async function locateWithNominatim(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  const { response, body } = await fetchJson(url, LOCATE_TIMEOUT_MS, {
    headers: { "user-agent": "sentinel-civic/1.0 (civic onboarding reverse geocoder)" },
  });
  if (!response.ok || !body?.address) return null;
  const address = body.address;
  return normalizeLocatedPlace(
    {
      city: address.city || address.town || address.village || address.municipality,
      county: address.county,
      state: address.state,
      stateAbbr: address["ISO3166-2-lvl4"],
    },
    lat,
    lng,
    "nominatim",
  );
}

async function locateWithCensus(lat, lng) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  const { response, body } = await fetchJson(url, LOCATE_TIMEOUT_MS);
  if (!response.ok) return null;
  const geographies = body?.result?.geographies || body?.result?.addressMatches?.[0]?.geographies;
  const place = geographies?.["Incorporated Places"]?.[0];
  const county = geographies?.Counties?.[0];
  const state = geographies?.States?.[0];
  return normalizeLocatedPlace(
    {
      city: cleanText(place?.BASENAME || place?.NAME, 100).replace(/\s+(city|town|village|borough)$/i, ""),
      county: county?.NAME,
      state: state?.NAME,
      stateAbbr: state?.STUSAB,
    },
    lat,
    lng,
    "census",
  );
}

export async function locateCity(latValue, lngValue) {
  if (latValue == null || lngValue == null || !String(latValue).trim() || !String(lngValue).trim())
    throw Object.assign(new Error("Valid latitude and longitude are required."), {
      status: 400,
      code: "invalid_coordinates",
    });
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
    throw Object.assign(new Error("Valid latitude and longitude are required."), {
      status: 400,
      code: "invalid_coordinates",
    });

  const roundedLat = Number(lat.toFixed(4));
  const roundedLng = Number(lng.toFixed(4));
  const cacheKey = `onboard:locate:${roundedLat.toFixed(4)},${roundedLng.toFixed(4)}`;
  const db = locateDb();
  try {
    const cached = readCache(db, cacheKey);
    if (cached) return cached;
  } finally {
    db.close();
  }

  let located = null;
  try {
    located = await locateWithNominatim(roundedLat, roundedLng);
  } catch {
    /* The Census endpoint below is the US-only fallback. */
  }
  if (!located) {
    try {
      located = await locateWithCensus(roundedLat, roundedLng);
    } catch {
      /* Converted to a stable municipality-not-found response below. */
    }
  }
  if (!located) throw municipalityError();

  const cache = locateDb();
  try {
    writeCache(cache, cacheKey, located);
  } finally {
    cache.close();
  }
  return located;
}

export async function searchCities(queryValue) {
  const query = cleanText(queryValue, 120);
  if (query.length < 3)
    throw Object.assign(new Error("Enter at least 3 characters to search for a U.S. city."), {
      status: 400,
      code: "invalid_city_query",
    });

  const cacheKey = `onboard:search-city:v1:${query.toLowerCase()}`;
  const db = locateDb();
  try {
    const cached = readCache(db, cacheKey);
    if (Array.isArray(cached)) return cached;
  } finally {
    db.close();
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  let response;
  let body;
  try {
    ({ response, body } = await fetchJson(url, LOCATE_TIMEOUT_MS, {
      headers: { "user-agent": "sentinel-civic/1.0 (city search for civic onboarding)" },
    }));
  } catch (error) {
    throw Object.assign(new Error(`City search is temporarily unavailable: ${failureReason(error)}`), {
      status: 502,
      code: "city_search_unavailable",
    });
  }
  if (!response.ok || !Array.isArray(body))
    throw Object.assign(new Error(`City search is temporarily unavailable (HTTP ${response.status}).`), {
      status: 502,
      code: "city_search_unavailable",
    });

  const results = body.flatMap((row) => {
    const address = row?.address || {};
    const countryCode = String(address.country_code || "").toLowerCase();
    const city = cleanText(address.city || address.town || address.village || address.municipality, 100);
    const state = cleanText(address.state, 80);
    const stateAbbr = stateAbbreviation(state, address["ISO3166-2-lvl4"]);
    const county = cleanText(address.county, 120);
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (countryCode !== "us" || !city || !state || !stateAbbr || !county || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      label: `${city}, ${state} · ${county}`,
      city,
      state,
      stateAbbr,
      county,
      lat,
      lng,
    }];
  }).filter((row, index, rows) => rows.findIndex((other) =>
    other.city === row.city && other.stateAbbr === row.stateAbbr && other.county === row.county
  ) === index).slice(0, 5);

  const writeDb = locateDb();
  try {
    writeCache(writeDb, cacheKey, results);
  } finally {
    writeDb.close();
  }
  return results;
}

export function deterministicProposal(city, state, countyValue) {
  const citySlug = slugify(city);
  const stateSlug = slugify(state);
  const stateNameSlug = slugify(STATE_NAME[state]);
  const county = cleanText(countyValue, 120);
  return {
    candidates: unique([
      citySlug,
      `${citySlug}${stateSlug}`,
      `${citySlug}${stateNameSlug}`,
      `cityof${citySlug}`,
      `cityof${citySlug}${stateSlug}`,
    ]),
    county,
    arcgisQuery: county ? `parcels ${county} ${state}` : `parcels ${city} ${state}`,
  };
}

function parseJsonObject(value) {
  const text = String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The search model did not return JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function normalizePortalCandidate(value) {
  const raw = cleanText(value, 300).replace(/[),.;]+$/, "");
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(":")
    ) return null;
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return {
      hostname,
      rootUrl: `https://${hostname}`,
      portalUrl: `https://${hostname}${pathname}`,
    };
  } catch {
    return null;
  }
}

function vendorForHostname(hostname) {
  if (/(^|\.)civicclerk\.com$/.test(hostname)) return "civicclerk";
  if (/(^|\.)legistar\.com$/.test(hostname)) return "legistar";
  if (/(^|\.)escribemeetings\.com$/.test(hostname)) return "escribe";
  if (/(^|\.)primegov\.com$/.test(hostname)) return "primegov";
  if (/(^|\.)novusagenda\.com$/.test(hostname)) return "novusagenda";
  if (/(^|\.)boarddocs\.com$/.test(hostname)) return "boarddocs";
  if (/(^|\.)granicus\.com$/.test(hostname)) return "granicus";
  if (/(^|\.)civicplus\.com$/.test(hostname)) return "civicplus";
  if (/(^|\.)municode\.com$/.test(hostname)) return "municode";
  if (/(^|\.)iqm2\.com$/.test(hostname)) return "iqm2";
  return "other";
}

function tenantForHostname(hostname, vendor) {
  const suffixByVendor = {
    civicclerk: ".civicclerk.com",
    legistar: ".legistar.com",
    escribe: ".escribemeetings.com",
    primegov: ".primegov.com",
    novusagenda: ".novusagenda.com",
    boarddocs: ".boarddocs.com",
    granicus: ".granicus.com",
    civicplus: ".civicplus.com",
    municode: ".municode.com",
    iqm2: ".iqm2.com",
  };
  const suffix = suffixByVendor[vendor];
  if (!suffix || !hostname.endsWith(suffix)) return null;
  const labels = hostname
    .slice(0, -suffix.length)
    .split(".")
    .filter((label) => label && !["www", "api", "portal", "pub", "go", "webapi", "library"].includes(label));
  return cleanText(labels.join("."), 100) || null;
}

function knownPortalProbeUrls(candidate) {
  const { vendor, tenantSlug, rootUrl, portalUrl } = candidate;
  const urls = [rootUrl];
  if (vendor === "escribe") urls.push(`${rootUrl}/MeetingsCalendarView.aspx`);
  if (vendor === "primegov") urls.push(`${rootUrl}/public/portal`);
  if (vendor === "novusagenda") urls.push(`${rootUrl}/agendapublic/`);
  if (vendor === "iqm2") urls.push(`${rootUrl}/Citizens/Default.aspx`);
  if (portalUrl !== rootUrl) urls.push(portalUrl);
  if (vendor === "civicclerk" && tenantSlug)
    urls.push(`https://${tenantSlug}.api.civicclerk.com/v1/Events?%24top=1`);
  if (vendor === "legistar" && tenantSlug)
    urls.push(`https://webapi.legistar.com/v1/${tenantSlug}/events?%24top=1`);
  return unique(urls);
}

export async function proposeTenantCandidates(city, state) {
  if (!process.env.OPENROUTER_API_KEY)
    return {
      candidates: [],
      reason: "OPENROUTER_API_KEY is not configured; deterministic candidates were used.",
    };
  const prompt = `Propose 9 plausible Legistar or CivicClerk tenant identifiers for ${city}, ${STATE_NAME[state] || state} (${state}). Use your knowledge of how this specific city's civic portal is actually named, plus common naming conventions. Naming is irregular: Austin uses "austintexas", San Jose uses "sanjose", and Fishers uses "fishersin". Return strict JSON only in this exact shape: {"candidates":["slug1","slug2"]}. Return 8-12 lowercase alphanumeric candidates, ordered most likely first. Do not return URLs, prose, or claim that any candidate is verified; the server probes every candidate independently.`;
  try {
    const { response, body } = await fetchJson(
      "https://openrouter.ai/api/v1/chat/completions",
      WEB_SEARCH_TIMEOUT_MS,
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
                "Return JSON only. Tenant guesses are untrusted until independently probed.",
            },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    const parsed = parseJsonObject(body?.choices?.[0]?.message?.content);
    const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const candidates = unique(rows.map((row) => slugify(typeof row === "string" ? row : row?.slug)))
      .slice(0, MAX_LLM_CANDIDATES);
    return {
      candidates,
      reason: `${candidates.length} OpenRouter candidate${candidates.length === 1 ? "" : "s"} returned and merged with deterministic candidates.`,
    };
  } catch (error) {
    return {
      candidates: [],
      reason: `OpenRouter candidate generation failed gracefully: ${failureReason(error)}`,
    };
  }
}

export async function probeVendor(vendor, slug) {
  const url =
    vendor === "civicclerk"
      ? `https://${slug}.api.civicclerk.com/v1/Events?%24top=1`
      : vendor === "primegov"
        ? `https://${slug}.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=${new Date().getFullYear()}`
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
    const sample =
      vendor === "civicclerk"
        ? rows[0]?.eventName || rows[0]?.categoryName
        : vendor === "primegov"
          ? rows[0]?.title
          : rows[0]?.EventBodyName || rows[0]?.EventComment;
    return {
      ...attempt,
      verified: true,
      evidence: {
        status: response.status,
        sample: cleanText(sample, 180) || "Verified tenant endpoint (no event returned on the first page).",
        firstPageRecords: rows.length,
      },
    };
  } catch (error) {
    return { ...attempt, status: null, reason: failureReason(error) };
  }
}

async function probeDiscoveredPortal(candidate) {
  const attempt = {
    kind: "meetings",
    vendor: candidate.vendor,
    tenantSlug: candidate.tenantSlug,
    url: candidate.portalUrl,
    verified: false,
    discoveryPath: "web search",
    candidateReason: candidate.why,
    vendorClaim: candidate.vendorClaim,
  };
  const probeUrls = knownPortalProbeUrls(candidate);
  const probes = await Promise.all(
    probeUrls.map(async (url) => {
      try {
        return await fetchPortal(url);
      } catch (error) {
        return { url, status: null, success: false, snippet: failureReason(error) };
      }
    }),
  );

  let vendorProbe = null;
  if (["civicclerk", "legistar"].includes(candidate.vendor) && candidate.tenantSlug)
    vendorProbe = await probeVendor(candidate.vendor, candidate.tenantSlug);
  const successfulProbe = probes.find((probe) => probe.success);
  const verified = vendorProbe ? vendorProbe.verified : Boolean(successfulProbe);
  const evidenceProbe = vendorProbe?.verified
    ? {
        url: vendorProbe.url,
        status: vendorProbe.status,
        success: true,
        snippet: vendorProbe.evidence.sample,
      }
    : successfulProbe;
  if (!verified || !evidenceProbe) {
    const statusSummary = probes
      .map((probe) => `${probe.url} returned ${probe.status == null ? "no response" : `HTTP ${probe.status}`}`)
      .join("; ");
    return {
      ...attempt,
      status: vendorProbe?.status ?? successfulProbe?.status ?? probes[0]?.status ?? null,
      probeUrl: vendorProbe?.url || successfulProbe?.url || probes[0]?.url,
      probes,
      reason: `${candidate.why} Verification failed: ${vendorProbe?.reason || statusSummary || "no probe succeeded."}`,
    };
  }
  return {
    ...attempt,
    slug: ["civicclerk", "legistar"].includes(candidate.vendor)
      ? candidate.tenantSlug
      : undefined,
    status: evidenceProbe.status,
    probeUrl: evidenceProbe.url,
    probes,
    verified: true,
    evidence: {
      status: evidenceProbe.status,
      sample: cleanText(evidenceProbe.snippet, 180),
      probeUrl: evidenceProbe.url,
      rootStatus: probes.find((probe) => probe.url === candidate.rootUrl)?.status ?? null,
      probes: probes.map(({ url, status, success, snippet }) => ({
        url,
        status,
        success,
        snippet: cleanText(snippet, 120),
      })),
    },
  };
}

/**
 * A responding FeatureServer is not the same as the *right* FeatureServer.
 * Keyword-only matching previously marked Chili_Parcels (a town in New York)
 * as verified for Fishers, IN. A candidate must now name the target city or
 * county in its title/snippet/owner, and the state must not contradict.
 * Returning no parcel source is strictly better than returning a wrong one.
 */
function arcgisRelevance(item, context) {
  const city = cleanText(context?.city, 80).toLowerCase();
  const county = cleanText(context?.county, 120)
    .toLowerCase()
    .replace(/\s+county$/, "")
    .trim();
  const state = cleanText(context?.state, 2).toUpperCase();
  const stateName = (STATE_NAME[state] || "").toLowerCase();
  const haystack = [item?.title, item?.snippet, item?.owner, item?.description, ...(item?.tags || [])]
    .map((value) => cleanText(value, 400).toLowerCase())
    .join(" ");
  if (!haystack) return { relevant: false, reason: "No title or description to match against." };

  // Reject a service that names a different US state outright.
  const named = Object.entries(STATE_ABBR).filter(
    ([name]) => name.toLowerCase() !== stateName && new RegExp(`\\b${name.toLowerCase()}\\b`).test(haystack),
  );
  if (named.length && stateName && !haystack.includes(stateName))
    return { relevant: false, reason: `Service references ${named[0][0]}, not ${STATE_NAME[state] || state}.` };

  const cityHit = city.length > 2 && new RegExp(`\\b${city.replace(/[^a-z0-9 ]/g, "")}\\b`).test(haystack);
  const countyHit = county.length > 2 && new RegExp(`\\b${county.replace(/[^a-z0-9 ]/g, "")}\\b`).test(haystack);
  if (!cityHit && !countyHit)
    return {
      relevant: false,
      reason: `Service does not name ${context?.city || "the city"} or ${context?.county || "its county"}; a responding endpoint is not proof it covers this jurisdiction.`,
    };
  return {
    relevant: true,
    matchedOn: cityHit ? `city name "${context.city}"` : `county name "${context.county}"`,
  };
}

export async function discoverArcgis(query, context = {}) {
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
    const rejected = [];
    const candidates = body.results
      .filter((item) => {
        const serviceUrl = String(item?.url || "").replace(/\/$/, "");
        const shaped =
          item?.type === "Feature Service" &&
          serviceUrl &&
          /(parcel|property|cadastr|tax\s*lot|assessor)/i.test(String(item?.title || "")) &&
          !seenServiceUrls.has(serviceUrl);
        if (!shaped) return false;
        // Jurisdiction check happens before the service is ever probed.
        const relevance = arcgisRelevance(item, context);
        if (!relevance.relevant) {
          if (rejected.length < 6)
            rejected.push({ title: cleanText(item?.title, 120), reason: relevance.reason });
          return false;
        }
        seenServiceUrls.add(serviceUrl);
        item.__matchedOn = relevance.matchedOn;
        return true;
      })
      .slice(0, MAX_ARCGIS_SERVICES);
    searchAttempt.rejectedForJurisdiction = rejected;
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
              jurisdictionMatch: item.__matchedOn || null,
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

export async function discoverCity(cityValue, stateValue, countyValue) {
  const city = cleanText(cityValue, 80);
  const state = cleanText(stateValue, 2).toUpperCase();
  const county = cleanText(countyValue, 120);
  if (!city || !/^[A-Z]{2}$/.test(state))
    throw Object.assign(new Error("Enter a city and two-letter US state code."), {
      status: 400,
      code: "invalid_location",
    });

  const cacheKey = `onboard:discover:v4:${state}:${slugify(city)}`;
  const cacheDb = locateDb();
  try {
    const cached = readCache(cacheDb, cacheKey);
    if (cached?.sources && cached?.discovery) {
      const meeting = cached.sources.find((source) => source.kind === "meetings" && source.verified);
      const meetingsIngested = meeting?.slug && ["civicclerk", "legistar", "primegov"].includes(meeting.vendor)
        ? cityMeetingStatus(city, meeting.vendor, meeting.slug).meetingsIngested
        : 0;
      return {
        ...cached,
        meetingsIngested,
        discovery: { ...cached.discovery, cacheHit: true },
      };
    }
  } finally {
    cacheDb.close();
  }

  const proposal = deterministicProposal(city, state, county);
  const llmProposal = await proposeTenantCandidates(city, state);
  const candidates = unique([...proposal.candidates, ...llmProposal.candidates]).slice(0, MAX_CANDIDATES);
  const [meetingAttempts, arcgis] = await Promise.all([
    Promise.all(candidates.flatMap((slug) =>
      ["legistar", "civicclerk", "primegov"].map((vendor) => probeVendor(vendor, slug))
    )),
    discoverArcgis(proposal.arcgisQuery, { city, state, county }),
  ]);
  const patternAttempts = meetingAttempts.map((attempt) => ({
    ...attempt,
    discoveryPath: "multi-hypothesis probe",
  }));
  const verifiedMeetings = ["legistar", "civicclerk", "primegov"].flatMap((vendor) => {
    const match = patternAttempts.find((item) => item.vendor === vendor && item.verified);
    return match ? [match] : [];
  });
  const discoveryPath = verifiedMeetings.length ? "multi-hypothesis probe" : null;
  const vendorSummary = (vendor) => {
    const attempts = patternAttempts.filter((item) => item.vendor === vendor);
    const verified = attempts.find((item) => item.verified);
    if (verified) return `Tried ${candidates.length} candidate identifiers; verified ${vendor === "legistar" ? "Legistar" : "CivicClerk"} tenant '${verified.slug}'.`;
    const blocked = attempts.find((item) => item.status === 403);
    if (blocked) return `Tried ${candidates.length} candidate identifiers; tenant candidate '${blocked.slug}' exists but was blocked (HTTP 403).`;
    if (attempts.length && attempts.every((item) => item.status == null))
      return `Tried ${candidates.length} candidate identifiers; network errors prevented ${vendor === "legistar" ? "Legistar" : "CivicClerk"} verification.`;
    const networkErrors = attempts.filter((item) => item.status == null).length;
    return `No ${vendor === "legistar" ? "Legistar" : "CivicClerk"} tenant found after ${candidates.length} candidates tried${networkErrors ? `; ${networkErrors} network error${networkErrors === 1 ? "" : "s"}` : ""}.`;
  };
  const verifiedParcels = arcgis.serviceAttempts.filter((item) => item.verified);
  const ingestibleMeeting = verifiedMeetings.find(
    (item) => item.slug && ["civicclerk", "legistar", "primegov"].includes(item.vendor),
  );
  const meetingsIngested = ingestibleMeeting
    ? cityMeetingStatus(city, ingestibleMeeting.vendor, ingestibleMeeting.slug).meetingsIngested
    : 0;
  const sources = [
    ...verifiedMeetings.map((item) => ({
      kind: "meetings",
      vendor: item.vendor,
      slug: item.slug,
      tenantSlug: item.tenantSlug || item.slug,
      url: item.url,
      verified: true,
      discoveryPath: item.discoveryPath || discoveryPath,
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
    ...patternAttempts,
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
  const result = {
    city,
    state,
    county: county || proposal.county || null,
    discoveryPath,
    discovery: {
      path: discoveryPath,
      cacheHit: false,
      candidatesTried: candidates.length,
      candidateIdentifiers: candidates,
      endpointProbes: patternAttempts.length,
      deterministicCandidates: proposal.candidates.length,
      llmCandidates: llmProposal.candidates.length,
      proposalReason: llmProposal.reason,
      evidence: verifiedMeetings[0]?.evidence || null,
    },
    steps: [
      {
        id: "propose",
        label: "Generating tenant candidates",
        status: "complete",
        detail: `${candidates.length} identifiers merged from deterministic rules and OpenRouter proposals; all were probed against both vendors.`,
      },
      step(
        "civicclerk",
        "Verifying CivicClerk tenants",
        verifiedMeetings.some((item) => item.vendor === "civicclerk"),
        vendorSummary("civicclerk"),
      ),
      step(
        "legistar",
        "Verifying Legistar tenants",
        verifiedMeetings.some((item) => item.vendor === "legistar"),
        vendorSummary("legistar"),
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
    ingestible: Boolean(ingestibleMeeting),
    meetingsIngested,
  };
  const writeDb = locateDb();
  try {
    writeCache(writeDb, cacheKey, result);
  } finally {
    writeDb.close();
  }
  return result;
}

function meetingDb() {
  // Schema (including city_slug/portal_url and the document + checkpoint
  // tables) is owned by server/city.mjs so reads and writes cannot drift.
  const db = openCityDb();
  const columns = db.prepare("PRAGMA table_info(onboarded_meetings)").all();
  if (!columns.some((column) => column.name === "city_slug"))
    db.exec("ALTER TABLE onboarded_meetings ADD COLUMN city_slug TEXT");
  if (!columns.some((column) => column.name === "portal_url"))
    db.exec("ALTER TABLE onboarded_meetings ADD COLUMN portal_url TEXT");
  ensureCache(db);
  return db;
}

async function fetchMeetingPages(vendor, slug, onProgress = () => {}) {
  const rows = [];
  // PrimeGov has no offset paging — its public portal is indexed by calendar
  // year, so walk backwards from this year until the archive runs dry.
  if (vendor === "primegov") {
    const thisYear = new Date().getFullYear();
    for (let year = thisYear; year >= thisYear - 8; year -= 1) {
      const { response, body } = await fetchJson(
        `https://${slug}.primegov.com/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`,
        10_000,
      );
      if (!response.ok || !Array.isArray(body)) continue;
      rows.push(...body.map((row) => ({ ...row, __year: year })));
      onProgress({ fetched: rows.length });
    }
    return rows;
  }
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
    onProgress({ fetched: rows.length });
  }
  throw Object.assign(new Error("Meeting pagination exceeded the safety limit."), {
    status: 502,
    code: "pagination_limit",
  });
}

export async function ingestMeetings(vendorValue, slugValue, cityValue, options = {}) {
  const vendor = cleanText(vendorValue, 20).toLowerCase();
  const slug = slugify(slugValue);
  const city = cleanText(cityValue, 80);
  const state = cleanText(options.state, 40) || null;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  if (!city || !slug || !["civicclerk", "legistar", "primegov"].includes(vendor))
    throw Object.assign(new Error("A valid city, vendor, and slug are required."), {
      status: 400,
      code: "invalid_ingest_request",
    });
  const key = citySlug(city);
  const rows = await fetchMeetingPages(vendor, slug, onProgress);
  const fetchedAt = new Date().toISOString();
  const normalized = rows
    .map((row) => {
      const eventId =
        vendor === "civicclerk" || vendor === "primegov" ? row?.id : row?.EventId;
      const name =
        vendor === "civicclerk"
          ? row?.eventName || row?.categoryName
          : vendor === "primegov"
            ? row?.title
            : row?.EventBodyName || row?.EventComment;
      if (eventId == null || !cleanText(name)) return null;
      return {
        city,
        city_slug: key,
        vendor,
        slug,
        event_id: String(eventId),
        portal_url: portalUrlFor(vendor, slug, eventId),
        name: cleanText(name, 300),
        body: cleanText(
          vendor === "civicclerk"
            ? row?.categoryName || row?.agendaName
            : vendor === "primegov"
              ? row?.title
              : row?.EventBodyName,
          300,
        ),
        start_datetime: cleanText(
          vendor === "civicclerk"
            ? row?.startDateTime || row?.eventDate
            : vendor === "primegov"
              ? row?.dateTime
              : row?.EventDate,
          80,
        ),
        raw_json: JSON.stringify(row),
        fetched_at: fetchedAt,
      };
    })
    .filter(Boolean);
  const db = meetingDb();
  let summary = null;
  try {
    const upsert = db.prepare(`INSERT INTO onboarded_meetings
      (city,city_slug,vendor,slug,event_id,name,body,start_datetime,portal_url,raw_json,fetched_at)
      VALUES (@city,@city_slug,@vendor,@slug,@event_id,@name,@body,@start_datetime,@portal_url,@raw_json,@fetched_at)
      ON CONFLICT(city,vendor,slug,event_id) DO UPDATE SET
        city_slug=excluded.city_slug, name=excluded.name, body=excluded.body,
        start_datetime=excluded.start_datetime, portal_url=excluded.portal_url,
        raw_json=excluded.raw_json, fetched_at=excluded.fetched_at`);
    db.transaction((items) => items.forEach((item) => upsert.run(item)))(normalized);
    // Publish the summary the app reads so onboarding stops being a dead end.
    summary = rebuildCitySummary(db, key, { city, state, vendor, vendorSlug: slug });
  } finally {
    db.close();
  }
  return {
    city,
    citySlug: key,
    ingested: normalized.length,
    summary,
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
