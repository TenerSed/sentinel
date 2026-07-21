import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createServer as createViteServer } from "vite";
import neo4j from "neo4j-driver";
import { findings, near, predict } from "./insights.mjs";
import { terminalEntity, terminalGraph, terminalSearch } from "./terminal.mjs";
import {
  homeHighlights,
  homeStats,
  nearAddresses,
  cachedNearFeed,
} from "./near.mjs";
import { mapCases, mapParcel } from "./map.mjs";
import { cityMeetingStatus, discoverCity, ingestMeetings, locateCity, searchCities } from "./onboard.mjs";
import { streamAdapter, streamDiscovery } from "./discover-stream.mjs";
import {
  cityDetail,
  cityDocuments,
  citySlug,
  listCities,
  resolveRuntimeDbPath,
} from "./city.mjs";
import { getJob, startIngestJob } from "./onboard-jobs.mjs";
import { cityGraphPayload, cityGraphSummary, graphJob, graphJobForCity, startGraphBuild } from "./graph-jobs.mjs";
import { createCaseCatalog } from "./cases.mjs";
import {
  cacheHealth,
  cacheKeyForCase,
  ensureCache,
  readCache,
  readCaseCaches,
  writeCache,
} from "./cache.mjs";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || 5173);
const json = (response, status, value, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
};
const cachedJson = (response, value, hit) =>
  json(response, 200, value, { "x-app-cache": hit ? "hit" : "miss" });
try {
  for (const line of fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch {
  /* .env is optional outside local graph development. */
}
process.env.ALLOW_SLOW_LLM = "0";
const graphDriver =
  process.env.NEO4J_URI && process.env.NEO4J_PASSWORD
    ? neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(
          process.env.NEO4J_USER || "neo4j",
          process.env.NEO4J_PASSWORD,
        ),
        { connectionTimeout: 1500 },
      )
    : null;
let fishersDb = null;
// Single source of truth, shared with the onboarding/ingest path.
const runtimeDbPath = resolveRuntimeDbPath();
try {
  if (!runtimeDbPath) throw new Error("No Sentinel runtime database was found.");
  fishersDb = new Database(runtimeDbPath, {
    fileMustExist: true,
  });
  fishersDb.pragma("journal_mode = WAL");
  ensureCache(fishersDb);
  fishersDb.exec(
    "CREATE INDEX IF NOT EXISTS idx_parcels_local_address_nocase ON parcels(local_address COLLATE NOCASE)",
  );
  console.log(`[sentinel] opened database: ${runtimeDbPath}`);
} catch (error) {
  console.warn(
    `[sentinel] database unavailable${runtimeDbPath ? `: ${runtimeDbPath}` : ""} (${error.message})`,
  );
  fishersDb = null;
}
const caseCatalog = createCaseCatalog(fishersDb);
const neo4jAvailable = async () => {
  if (!graphDriver) return false;
  try {
    await Promise.race([
      graphDriver.verifyConnectivity(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("health_timeout")), 1800),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
};
const graphTypes = [
  "VOTED",
  "MADE_MOTION",
  "APPLICANT_FOR",
  "REPRESENTS",
  "CONCERNS",
  "REZONE_FROM",
  "REZONE_TO",
  "HEARD_AT",
  "EVIDENCED_BY",
];
const graphQuery = (layer, limit) => {
  const capped = neo4j.int(limit * 3),
    half = neo4j.int(Math.max(1, Math.floor(limit * 1.5))),
    cases = neo4j.int(Math.max(1, Math.floor(limit / 6)));
  const structured = `MATCH (c:Case) CALL { WITH c MATCH (c)--() RETURN count(*) AS degree } WITH c,degree ORDER BY degree DESC LIMIT $caseLimit MATCH (c)-[r]-(n) WHERE type(r) IN $types RETURN c AS a,r,n AS b LIMIT $structuredLinkLimit`;
  const open = `MATCH (o:OpenEntity)-[r]-(n) WITH o,r,n, CASE WHEN n:Document THEN 2 ELSE 1 END AS document_weight ORDER BY document_weight DESC, elementId(o) RETURN o AS a,r,n AS b LIMIT $openLinkLimit`;
  return layer === "open"
    ? { query: open, params: { openLinkLimit: capped } }
    : layer === "both"
      ? {
          query: `CALL { ${structured} UNION ALL ${open} } RETURN a,r,b LIMIT $totalLinkLimit`,
          params: {
            caseLimit: neo4j.int(Math.max(1, Math.floor(limit / 12))),
            types: graphTypes,
            structuredLinkLimit: half,
            openLinkLimit: half,
            totalLinkLimit: capped,
          },
        }
      : {
          query: structured,
          params: {
            caseLimit: cases,
            types: graphTypes,
            structuredLinkLimit: capped,
          },
        };
};
const graphPayload = async (layer, limit) => {
  if (!graphDriver) return { nodes: [], links: [], error: "neo4j_unavailable" };
  const session = graphDriver.session();
  try {
    const { query, params } = graphQuery(layer, limit);
    const result = await session.run(query, params);
    const nodes = new Map(),
      links = new Map();
    const add = (node) => {
      const id = node.elementId;
      if (nodes.has(id) || nodes.size >= limit) return nodes.has(id);
      const labels = node.labels || [];
      const label =
        labels.find((item) => item !== "OpenEntity") || labels[0] || "Entity";
      const p = node.properties || {};
      nodes.set(id, {
        id,
        label,
        caption: String(
          p.case_number ??
            p.name ??
            p.address ??
            p.code ??
            p.title ??
            p.doc_id ??
            id,
        ),
        group: label,
      });
      return true;
    };
    for (const record of result.records) {
      const a = record.get("a"),
        b = record.get("b"),
        r = record.get("r");
      if (!add(a) || !add(b)) continue;
      const source = r.startNodeElementId,
        target = r.endNodeElementId,
        key = `${source}:${r.type}:${target}`;
      if (links.size < limit * 4 && !links.has(key))
        links.set(key, { source, target, type: r.type });
    }
    return {
      nodes: [...nodes.values()],
      links: [...links.values()],
      counts: { nodes: nodes.size, links: links.size },
    };
  } finally {
    await session.close();
  }
};
const nodeLabel = (node) =>
  (node.labels || []).find((item) => item !== "OpenEntity") ||
  node.labels?.[0] ||
  "Entity";
const nodeCaption = (node) => {
  const p = node.properties || {};
  return String(
    p.case_number ??
      p.name ??
      p.address ??
      p.code ??
      p.title ??
      p.doc_id ??
      node.elementId,
  );
};
const snippet = (text, terms) => {
  const lower = text.toLowerCase();
  const hit =
    terms
      .map((term) => term && lower.indexOf(term.toLowerCase()))
      .find((index) => index >= 0) ?? 0;
  let start = Math.max(0, hit - 145),
    end = Math.min(text.length, hit + 155);
  if (start) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) {
    const boundary = text.lastIndexOf(" ", end);
    if (boundary > start) end = boundary;
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
};
const evidenceFor = async (session, source, sourceId, terms, startSeconds) => {
  if (!fishersDb || !source || !sourceId) return null;
  if (source === "minutes" || source === "packet") {
    const file = fishersDb
      .prepare("SELECT name,plaintext FROM cc_files WHERE file_id=?")
      .get(sourceId);
    if (!file?.plaintext) return null;
    const document = await session.run(
      "MATCH (d:Document {doc_id:$id}) RETURN d.url AS url LIMIT 1",
      { id: `file:${sourceId}` },
    );
    return {
      docType: "document",
      docTitle: file.name || `CivicClerk file ${sourceId}`,
      snippet: snippet(file.plaintext, terms),
      citationUrl: document.records[0]?.get("url") || null,
    };
  }
  if (source === "transcript") {
    const cues = fishersDb
      .prepare(
        "SELECT text,start_seconds FROM yt_transcript_cues WHERE video_id=? ORDER BY sort_order",
      )
      .all(sourceId);
    if (!cues.length) return null;
    const cue =
      cues.find((item) =>
        terms.some(
          (term) =>
            term && item.text.toLowerCase().includes(term.toLowerCase()),
        ),
      ) ||
      cues.find(
        (item) => startSeconds == null || item.start_seconds >= startSeconds,
      ) ||
      cues[0];
    return {
      docType: "video",
      docTitle: `YouTube transcript ${sourceId}`,
      snippet: cue.text,
      citationUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(sourceId)}&t=${Math.floor(Number(cue.start_seconds || startSeconds || 0))}s`,
    };
  }
  return null;
};
const graphExpansion = async (id) => {
  if (!graphDriver || !fishersDb || !id)
    return { node: null, edges: [], error: "neo4j_unavailable" };
  const session = graphDriver.session();
  try {
    const nodeResult = await session.run(
      "MATCH (n) WHERE elementId(n)=$id RETURN n LIMIT 1",
      { id },
    );
    const node = nodeResult.records[0]?.get("n");
    if (!node) return { node: null, edges: [] };
    const edgeResult = await session.run(
      "MATCH (n)-[r]-(m) WHERE elementId(n)=$id RETURN r,m,CASE WHEN elementId(startNode(r))=$id THEN 'out' ELSE 'in' END AS direction LIMIT 120",
      { id },
    );
    const edges = [];
    for (const record of edgeResult.records) {
      const rel = record.get("r"),
        neighbor = record.get("m"),
        properties = rel.properties || {};
      const source = properties.source ?? null,
        sourceId = properties.source_id ?? null;
      const extraProps = Object.fromEntries(
        Object.entries(properties).filter(
          ([key]) =>
            ![
              "source",
              "source_id",
              "confidence",
              "extractor",
              "char_start",
              "char_end",
              "start_seconds",
            ].includes(key),
        ),
      );
      const neighborCaption = nodeCaption(neighbor),
        neighborLabel = nodeLabel(neighbor);
      edges.push({
        id: rel.elementId,
        type: rel.type,
        direction: record.get("direction"),
        neighbor: {
          id: neighbor.elementId,
          label: neighborLabel,
          caption: neighborCaption,
          group: neighborLabel,
        },
        source,
        source_id: sourceId,
        confidence: properties.confidence ?? null,
        extraProps,
        evidence: await evidenceFor(
          session,
          source,
          sourceId,
          [neighborCaption, nodeCaption(node)],
          properties.start_seconds,
        ),
      });
    }
    return {
      node: {
        id: node.elementId,
        label: nodeLabel(node),
        caption: nodeCaption(node),
        props: node.properties || {},
      },
      edges,
    };
  } finally {
    await session.close();
  }
};

// The deep case catalog (parcels, graph entities, video receipts) exists only
// for the reference city. Every other city has meetings ingested but no case
// extraction, so these endpoints must return an explicit, honest empty rather
// than silently handing back Fishers records under another city's name.
const REFERENCE_CITY = "fishers";
function caseScope(request, { shape = "list" } = {}) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requested = citySlug(url.searchParams.get("city") || "");
  if (!requested || requested === REFERENCE_CITY) return null;
  const summary = (() => {
    try {
      return listCities().cities.find((city) => city.citySlug === requested) || null;
    } catch {
      return null;
    }
  })();
  const reason = summary
    ? `${summary.city} has ${summary.meetings.toLocaleString()} meetings ingested but no case-level extraction yet. Case records are only built for ${REFERENCE_CITY}. Browse this city's meetings at /api/city?slug=${requested}.`
    : `No data has been ingested for "${requested}". Onboard the city first. Case records from another city are never substituted.`;
  const payload = {
    citySlug: requested,
    cases: [],
    unavailable: true,
    reason,
    meetingsAvailable: summary?.meetings || 0,
    meetingsEndpoint: summary ? `/api/city?slug=${requested}` : null,
  };
  return shape === "map" ? { ...payload, features: [] } : payload;
}

const vite = production
  ? null
  : await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url?.startsWith("/investigate")) {
    response.writeHead(302, { location: "/terminal", "cache-control": "no-store" });
    return response.end();
  }
  if (request.method === "GET" && request.url?.startsWith("/api/health")) {
    let db = false;
    try {
      db = Boolean(fishersDb?.prepare("SELECT 1 AS ok").get()?.ok);
    } catch {
      db = false;
    }
    return json(response, 200, {
      neo4j: await neo4jAvailable(),
      cache: cacheHealth(fishersDb),
      db,
    });
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/search-city")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(response, 200, await searchCities(url.searchParams.get("q")));
    } catch (error) {
      return json(response, error.status || 502, {
        error: error.code || "city_search_failed",
        message: error.message || "City search is temporarily unavailable.",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/locate")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        await locateCity(
          url.searchParams.get("lat"),
          url.searchParams.get("lng"),
        ),
      );
    } catch (error) {
      return json(response, error.status || 502, {
        error: error.code || "reverse_geocode_failed",
        message: error.message || "This location could not be identified.",
      });
    }
  }
  // Live per-city graph build: start it, keep using the app, come back to it.
  if (request.method === "GET" && request.url?.startsWith("/api/graph/build")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      const job = startGraphBuild({
        citySlug: url.searchParams.get("slug"),
        place: url.searchParams.get("place"),
        limit: url.searchParams.get("limit"),
        concurrency: url.searchParams.get("concurrency"),
      });
      json(response, 202, job);
    } catch (error) {
      json(response, error.status || 500, {
        error: error.code || "graph_build_failed",
        message: error.message,
      });
    }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/graph/status")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const id = url.searchParams.get("job");
    const slug = url.searchParams.get("slug");
    const job = id ? graphJob(id) : graphJobForCity(slug);
    const summary = await cityGraphSummary(graphDriver, slug || job?.citySlug);
    if (!job && !summary.nodeTotal) {
      json(response, 404, { error: "no_graph_job", message: "No graph has been built for this city yet." });
      return;
    }
    json(response, 200, { job: job || null, graph: summary });
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/city/graph")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const slug = url.searchParams.get("slug");
    const [summary, payload] = [
      await cityGraphSummary(graphDriver, slug),
      await cityGraphPayload(graphDriver, slug, Number(url.searchParams.get("limit")) || 220),
    ];
    json(response, 200, { ...payload, summary });
    return;
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/adapter/stream")
  ) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    await streamAdapter(request, response, url);
    return;
  }
  // Must be matched before /api/onboard/discover, which is a prefix of it.
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/discover/stream")
  ) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    await streamDiscovery(request, response, url);
    return;
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/discover")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        await discoverCity(
          url.searchParams.get("city"),
          url.searchParams.get("state"),
          url.searchParams.get("county"),
        ),
      );
    } catch (error) {
      return json(response, error.status || 500, {
        error: error.code || "onboard_discovery_failed",
        message: error.message || "City source discovery failed.",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/onboard/ingest")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      const vendor = url.searchParams.get("vendor");
      const slug = url.searchParams.get("slug");
      const city = url.searchParams.get("city");
      // A full ingest takes minutes, so the default is a background job the
      // client polls. `sync=1` keeps the original blocking behaviour available.
      if (url.searchParams.get("sync") === "1")
        return json(response, 200, await ingestMeetings(vendor, slug, city, {
          state: url.searchParams.get("state"),
        }));
      return json(response, 202, startIngestJob({
        vendor,
        slug,
        city,
        state: url.searchParams.get("state"),
        documents: url.searchParams.get("documents") !== "0",
        maxMeetings: Number(url.searchParams.get("maxMeetings")) || 25,
        budgetMs: Number(url.searchParams.get("budgetMs")) || 120_000,
      }));
    } catch (error) {
      return json(response, error.status || 500, {
        error: error.code || "onboard_ingest_failed",
        message: error.message || "Meeting ingestion failed.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/onboard/status")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const jobId = url.searchParams.get("job");
    if (jobId) {
      const job = getJob(jobId);
      if (!job)
        return json(response, 404, {
          error: "job_not_found",
          message: "That ingest job is unknown or expired. Start a new ingest.",
        });
      return json(response, 200, job);
    }
    return json(response, 200, cityMeetingStatus(
      url.searchParams.get("city"),
      url.searchParams.get("vendor"),
      url.searchParams.get("slug"),
    ));
  }
  if (request.method === "GET" && request.url?.startsWith("/api/cities")) {
    try {
      return json(response, 200, listCities());
    } catch (error) {
      return json(response, 500, {
        error: "cities_unavailable",
        message: error.message || "Onboarded cities could not be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/city/documents")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      return json(response, 200, cityDocuments(url.searchParams.get("slug"), {
        limit: url.searchParams.get("limit"),
      }));
    } catch (error) {
      return json(response, error.status || 500, {
        error: error.code || "city_documents_unavailable",
        message: error.message || "City documents could not be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/city")) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      return json(response, 200, cityDetail(url.searchParams.get("slug"), {
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
        q: url.searchParams.get("q"),
        body: url.searchParams.get("body"),
      }));
    } catch (error) {
      return json(response, error.status || 500, {
        error: error.code || "city_unavailable",
        message: error.message || "That city could not be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/stats")) {
    const cached = readCache(fishersDb, "stats");
    if (cached !== null) return cachedJson(response, cached, true);
    try {
      if (!graphDriver) throw new Error("graph");
      const payload = await homeStats(graphDriver, fishersDb);
      writeCache(fishersDb, "stats", payload);
      return cachedJson(response, payload, false);
    } catch {
      return json(response, 503, {
        error: "stats_unavailable",
        message:
          "Coverage statistics are unavailable because neither cached data nor the live graph could be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/highlights")) {
    const cached = readCache(fishersDb, "highlights");
    if (cached !== null) return cachedJson(response, cached, true);
    try {
      if (!graphDriver) throw new Error("graph");
      const payload = await homeHighlights(graphDriver);
      writeCache(fishersDb, "highlights", payload);
      return cachedJson(response, payload, false);
    } catch {
      return json(response, 503, {
        error: "highlights_unavailable",
        message:
          "Highlights are unavailable because neither cached data nor the live graph could be read.",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/insights/corpus")
  ) {
    const cached = readCache(fishersDb, "insights:corpus");
    if (cached !== null) return cachedJson(response, cached, true);
    return json(response, 503, {
      error: "corpus_insights_unavailable",
      message: "The precomputed public-record corpus snapshot is unavailable.",
    });
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/near/addresses")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        nearAddresses(
          fishersDb,
          url.searchParams.get("q") || "",
          url.searchParams.get("limit") || "8",
        ),
      );
    } catch {
      return json(response, 200, { addresses: [] });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/cases")) {
    const scope = caseScope(request);
    if (scope) return json(response, 200, scope);
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      const requestedSort = url.searchParams.get("sort") || "recent";
      const sort = ["recent", "status", "distance"].includes(requestedSort)
        ? requestedSort
        : "recent";
      const statuses = (url.searchParams.get("status") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return cachedJson(
        response,
        caseCatalog.query({
          q: url.searchParams.get("q") || "",
          statuses,
          sort,
          address: url.searchParams.get("address") || "",
        }),
        true,
      );
    } catch {
      return json(response, 503, {
        error: "cases_unavailable",
        message: "Cached Fishers land-use cases could not be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/near/feed")) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      const mapped = readCache(fishersDb, "map:cases");
      const cases = readCaseCaches(fishersDb);
      if (!mapped && !cases.length)
        return json(response, 503, {
          error: "near_unavailable",
          message:
            "Nearby cases are unavailable because no cached public-record snapshot exists.",
        });
      return cachedJson(
        response,
        cachedNearFeed(
          fishersDb,
          url.searchParams.get("address") || "",
          mapped || [],
          cases,
        ),
        true,
      );
    } catch {
      return json(response, 503, {
        error: "near_unavailable",
        message: "Nearby cached public-record data could not be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/near/case")) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    const caseNumber = (url.searchParams.get("case") || "")
      .trim()
      .toUpperCase();
    if (!caseNumber)
      return json(response, 400, {
        error: "invalid_case",
        message: "A case number is required.",
      });
    const key = cacheKeyForCase(caseNumber);
    const cached = readCache(fishersDb, key);
    if (cached !== null) return cachedJson(response, cached, true);
    return json(response, 404, {
      error: "case_not_cached",
      case_number: caseNumber,
      receipts: [],
      message: "This case is not present in the cached public-record snapshot.",
    });
  }
  if (request.method === "GET" && request.url?.startsWith("/api/map/cases")) {
    const scope = caseScope(request, { shape: "map" });
    if (scope) return json(response, 200, scope);
    const cached = readCache(fishersDb, "map:cases");
    if (cached !== null) return cachedJson(response, cached, true);
    try {
      if (!graphDriver) throw new Error("graph");
      const payload = await mapCases(graphDriver, fishersDb);
      writeCache(fishersDb, "map:cases", payload);
      return cachedJson(response, payload, false);
    } catch {
      return json(response, 503, {
        error: "map_unavailable",
        message:
          "Map cases are unavailable because neither cached data nor the live graph could be read.",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/map/parcel")) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        mapParcel(fishersDb, url.searchParams.get("address") || ""),
      );
    } catch {
      return json(response, 200, { error: "not_found" });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/terminal/search")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      const limit = Math.min(
        20,
        Math.max(
          1,
          Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20,
        ),
      );
      return json(
        response,
        200,
        await terminalSearch(
          graphDriver,
          url.searchParams.get("q") || "",
          limit,
        ),
      );
    } catch {
      return json(response, 200, {
        results: [],
        error: "terminal_unavailable",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/terminal/entity")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        await terminalEntity(
          graphDriver,
          fishersDb,
          url.searchParams.get("id") || "",
        ),
      );
    } catch {
      return json(response, 200, {
        node: null,
        stats: [],
        analytics: {},
        connections: [],
        evidence: [],
        narrative: { summary: "No dossier is available." },
        error: "terminal_unavailable",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/terminal/graph")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        await terminalGraph(
          graphDriver,
          url.searchParams.get("id") || "",
          Number(url.searchParams.get("hops") || 1),
        ),
      );
    } catch {
      return json(response, 200, {
        nodes: [],
        links: [],
        error: "terminal_unavailable",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/insights/findings")
  ) {
    try {
      if (!graphDriver) throw new Error("neo4j");
      return json(response, 200, { findings: await findings(graphDriver) });
    } catch {
      return json(response, 200, {
        findings: [],
        error: "insights_unavailable",
      });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/insights/predict")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      if (!graphDriver) throw new Error("neo4j");
      return json(
        response,
        200,
        await predict(graphDriver, {
          case: url.searchParams.get("case") || "",
        }),
      );
    } catch {
      return json(response, 200, { error: "insights_unavailable" });
    }
  }
  if (request.method === "POST" && request.url === "/api/insights/predict") {
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      if (!graphDriver) throw new Error("neo4j");
      const input = JSON.parse(body);
      return json(
        response,
        200,
        await predict(
          graphDriver,
          input && typeof input === "object" ? input : {},
        ),
      );
    } catch {
      return json(response, 200, { error: "insights_unavailable" });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/insights/near")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      if (!graphDriver || !fishersDb) throw new Error("data");
      return json(
        response,
        200,
        await near(
          graphDriver,
          fishersDb,
          url.searchParams.get("address") ||
            url.searchParams.get("parcel") ||
            "",
        ),
      );
    } catch {
      return json(response, 200, { error: "insights_unavailable" });
    }
  }
  if (
    request.method === "GET" &&
    request.url?.startsWith("/api/graph/expand")
  ) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      return json(
        response,
        200,
        await graphExpansion(url.searchParams.get("id")),
      );
    } catch {
      return json(response, 200, {
        node: null,
        edges: [],
        error: "neo4j_unavailable",
      });
    }
  }
  if (request.method === "GET" && request.url?.startsWith("/api/graph")) {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      const layer = ["structured", "open", "both"].includes(
        url.searchParams.get("layer") || "",
      )
        ? url.searchParams.get("layer")
        : "structured";
      const requested = Number.parseInt(
        url.searchParams.get("limit") || "250",
        10,
      );
      const limit = Number.isFinite(requested)
        ? Math.min(600, Math.max(1, requested))
        : 250;
      return json(response, 200, await graphPayload(layer, limit));
    } catch {
      return json(response, 200, {
        nodes: [],
        links: [],
        error: "neo4j_unavailable",
      });
    }
  }
  if (request.method === "GET" && request.url === "/api/chat/status")
    return json(response, 200, { live: { available: false, providers: [] }, mode: "bundled_only" });
  if (request.method === "POST" && request.url === "/api/chat") {
    return json(response, 503, {
      answer: { status: "insufficient", blocks: [] },
      error: "offline_only",
      message: "Request-time model calls are disabled; bundled grounded answers remain available in the feed.",
    });
  }
  if (vite)
    return vite.middlewares(request, response, () =>
      json(response, 404, { error: "not_found" }),
    );
  const asset =
    request.url === "/" ? "index.html" : request.url?.replace(/^\//, "");
  const target = path.resolve(root, "dist", asset || "index.html");
  if (
    !target.startsWith(path.join(root, "dist") + path.sep) ||
    !fs.existsSync(target)
  )
    return response.end(fs.readFileSync(path.join(root, "dist", "index.html")));
  response.end(fs.readFileSync(target));
});
server.listen(port, () =>
  console.log(`Lamplighter listening on http://localhost:${port}`),
);
