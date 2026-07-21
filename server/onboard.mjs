import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureCache, readCache, writeCache } from "./cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "lamplighter.db");
const REQUEST_TIMEOUT_MS = 6_000;
const WEB_SEARCH_TIMEOUT_MS = 40_000;
const MAX_CANDIDATES = 6;
const MAX_LLM_CANDIDATES = 5;
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

function deterministicProposal(city, state, countyValue) {
  const citySlug = slugify(city);
  const stateSlug = slugify(state);
  const countyByCity = {
    "carmel:IN": "Hamilton County Indiana",
    "fishers:IN": "Hamilton County Indiana",
    "san jose:CA": "Santa Clara County",
    "mountain view:CA": "Santa Clara County",
  };
  const county = cleanText(countyValue, 120) || countyByCity[`${city.toLowerCase()}:${state}`] || "";
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

async function searchMeetingPortals(city, state) {
  if (!process.env.OPENROUTER_API_KEY)
    return {
      candidates: [],
      reason: "OPENROUTER_API_KEY is not configured; web-search discovery was skipped.",
    };
  const prompt = `Search the live web for the official city-government meeting agenda portal for ${city}, ${state}. Find the portal hostname and vendor, not the city's general home page. Return strict JSON only in this exact shape: {"candidates":[{"host":"portal.example.gov","vendor":"vendor name","why":"brief evidence this belongs to the city"}]}. Return no more than 5 candidates. Common vendors include ${KNOWN_VENDORS.join(", ")}, but return any real official portal you find. Prefer direct public agenda, meeting, or legislative-management portals. Do not claim a portal works; our code will verify every candidate.`;
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
          model: "deepseek/deepseek-v4-flash:online",
          reasoning: { enabled: false },
          messages: [
            {
              role: "system",
              content:
                "Use web search to find candidates. Return JSON only. Candidate claims are untrusted until independently probed.",
            },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    const parsed = parseJsonObject(body?.choices?.[0]?.message?.content);
    const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const seen = new Set();
    const candidates = rows.flatMap((row) => {
      const normalized = normalizePortalCandidate(row?.host);
      if (!normalized || seen.has(normalized.portalUrl)) return [];
      seen.add(normalized.portalUrl);
      const vendor = vendorForHostname(normalized.hostname);
      return [{
        ...normalized,
        vendor,
        vendorClaim: cleanText(row?.vendor, 80) || null,
        tenantSlug: tenantForHostname(normalized.hostname, vendor),
        why: cleanText(row?.why, 220) || "Returned by the web-search model.",
      }];
    }).slice(0, MAX_LLM_CANDIDATES);
    return {
      candidates,
      reason: `${candidates.length} web-search candidate${candidates.length === 1 ? "" : "s"} returned; each was independently probed.`,
    };
  } catch (error) {
    return {
      candidates: [],
      reason: `Web-search discovery failed gracefully: ${failureReason(error)}`,
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

export async function discoverCity(cityValue, stateValue, countyValue) {
  const city = cleanText(cityValue, 80);
  const state = cleanText(stateValue, 2).toUpperCase();
  const county = cleanText(countyValue, 120);
  if (!city || !/^[A-Z]{2}$/.test(state))
    throw Object.assign(new Error("Enter a city and two-letter US state code."), {
      status: 400,
      code: "invalid_location",
    });

  const cacheKey = `onboard:discover:v3:${state}:${slugify(city)}`;
  const cacheDb = locateDb();
  try {
    const cached = readCache(cacheDb, cacheKey);
    if (cached?.sources?.some((source) => source.kind === "meetings" && source.verified)) {
      const meeting = cached.sources.find((source) => source.kind === "meetings" && source.verified);
      const meetingsIngested = meeting?.slug && ["civicclerk", "legistar"].includes(meeting.vendor)
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
  const arcgisPromise = discoverArcgis(proposal.arcgisQuery);
  const [civicAttempts, legistarAttempts, arcgis] = await Promise.all([
    Promise.all(
      proposal.civicclerkSlugs.map((slug) =>
        probeVendor("civicclerk", slug),
      ),
    ),
    Promise.all(
      proposal.legistarSlugs.map((slug) =>
        probeVendor("legistar", slug),
      ),
    ),
    arcgisPromise,
  ]);
  const patternAttempts = [...civicAttempts, ...legistarAttempts].map((attempt) => ({
    ...attempt,
    discoveryPath: "pattern probe",
  }));
  let verifiedMeetings = patternAttempts.filter((item) => item.verified);
  let webSearch = {
    candidates: [],
    reason: "Skipped because a fast pattern probe already verified a meetings source.",
  };
  let webSearchAttempts = [];
  if (!verifiedMeetings.length) {
    webSearch = await searchMeetingPortals(city, state);
    webSearchAttempts = await Promise.all(webSearch.candidates.map(probeDiscoveredPortal));
    verifiedMeetings = webSearchAttempts.filter((item) => item.verified);
  }

  const discoveryPath = patternAttempts.some((item) => item.verified)
    ? "pattern probe"
    : verifiedMeetings.length
      ? "web search"
      : null;
  const verifiedParcels = arcgis.serviceAttempts.filter((item) => item.verified);
  const ingestibleMeeting = verifiedMeetings.find(
    (item) => item.slug && ["civicclerk", "legistar"].includes(item.vendor),
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
    ...webSearchAttempts,
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
      candidatesTried: patternAttempts.length + webSearchAttempts.length,
      patternCandidatesTried: patternAttempts.length,
      webSearchCandidatesTried: webSearchAttempts.length,
      webSearchSkipped: patternAttempts.some((item) => item.verified),
      evidence: verifiedMeetings[0]?.evidence || null,
    },
    steps: [
      {
        id: "propose",
        label: "Generating fast pattern candidates",
        status: "complete",
        detail: `${patternAttempts.length} CivicClerk and Legistar candidates generated without a model call.`,
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
        id: "web-search",
        label: "Searching the web for an official meetings portal",
        status: patternAttempts.some((item) => item.verified)
          ? "skipped"
          : verifiedMeetings.length
            ? "verified"
            : "not_found",
        detail: webSearch.reason,
        evidence: discoveryPath === "web search" ? verifiedMeetings[0]?.evidence : undefined,
      },
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
  if (verifiedMeetings.length) {
    const writeDb = locateDb();
    try {
      writeCache(writeDb, cacheKey, result);
    } finally {
      writeDb.close();
    }
  }
  return result;
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
