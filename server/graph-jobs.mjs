// Live per-city graph builds.
//
// Graph extraction used to be a CLI step run by hand against Fishers. For any
// other city it has to be something the app starts: pick a city, kick the build
// off, keep using the product, come back to a finished graph. This module runs
// scripts/graph/city-extract.mjs as a child process, parses its JSON progress
// lines, and exposes the state over HTTP.
//
// Progress is durable enough to survive a page reload but not a server restart
// (the registry is in-memory). The extraction itself IS restart-safe: every
// completed chunk is checkpointed in `graph_extract_log`, so a re-run resumes.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openCityDb } from "./city.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobs = new Map();
const byCity = new Map();

const clean = (value, max = 300) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function graphJob(id) {
  return jobs.get(String(id)) || null;
}

export function graphJobForCity(citySlug) {
  const id = byCity.get(String(citySlug || "").toLowerCase());
  return id ? jobs.get(id) || null : null;
}

/**
 * Counts what has actually been written to Neo4j for a city. Read from the
 * graph itself rather than from job state, so a finished build still reports
 * honestly after the job registry is gone.
 */
export async function cityGraphSummary(driver, citySlug) {
  const slug = String(citySlug || "").toLowerCase();
  if (!driver) return { available: false, reason: "neo4j_unavailable", nodes: [], relationships: [] };
  const session = driver.session();
  try {
    const nodes = await session.run(
      "MATCH (n {city_slug:$slug}) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC",
      { slug },
    );
    const rels = await session.run(
      "MATCH ()-[r {city_slug:$slug}]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC",
      { slug },
    );
    const nodeRows = nodes.records.map((row) => ({
      label: row.get("label"),
      count: row.get("count").toNumber(),
    }));
    const relRows = rels.records.map((row) => ({
      type: row.get("type"),
      count: row.get("count").toNumber(),
    }));
    return {
      available: true,
      citySlug: slug,
      nodes: nodeRows,
      relationships: relRows,
      nodeTotal: nodeRows.reduce((sum, row) => sum + row.count, 0),
      relationshipTotal: relRows.reduce((sum, row) => sum + row.count, 0),
    };
  } catch (error) {
    return { available: false, reason: clean(error?.message, 200), nodes: [], relationships: [] };
  } finally {
    await session.close();
  }
}

/** A page of the city's graph, for rendering. */
export async function cityGraphPayload(driver, citySlug, limit = 220) {
  const slug = String(citySlug || "").toLowerCase();
  if (!driver) return { nodes: [], links: [], error: "neo4j_unavailable" };
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (a {city_slug:$slug})-[r]->(b {city_slug:$slug})
       RETURN a, r, b LIMIT toInteger($limit)`,
      { slug, limit },
    );
    const nodes = new Map();
    const links = [];
    const add = (node) => {
      const id = node.elementId;
      if (nodes.has(id)) return;
      const labels = node.labels || [];
      const label = labels[0] || "Entity";
      const p = node.properties || {};
      nodes.set(id, {
        id,
        label,
        group: label,
        caption: String(p.case_number ?? p.name ?? p.address ?? p.code ?? p.title ?? p.doc_id ?? id),
      });
    };
    for (const record of result.records) {
      const a = record.get("a");
      const b = record.get("b");
      const r = record.get("r");
      add(a);
      add(b);
      links.push({ source: r.startNodeElementId, target: r.endNodeElementId, type: r.type });
    }
    return { citySlug: slug, nodes: [...nodes.values()], links };
  } catch (error) {
    return { nodes: [], links: [], error: clean(error?.message, 200) };
  } finally {
    await session.close();
  }
}

function documentChunkEstimate(citySlug) {
  const db = openCityDb();
  try {
    const row = db
      .prepare(
        "SELECT count(*) AS documents, coalesce(sum(chars),0) AS chars FROM onboarded_documents WHERE city_slug = ?",
      )
      .get(citySlug);
    return {
      documents: Number(row?.documents || 0),
      // Must match the 2700-character stride in city-extract.mjs.
      chunks: Math.ceil(Number(row?.chars || 0) / 2700),
    };
  } finally {
    db.close();
  }
}

/**
 * Starts (or resumes) a graph build. Returns immediately with a job record;
 * poll graphJob(id) for progress.
 */
export function startGraphBuild({ citySlug, place, limit, concurrency }) {
  const slug = String(citySlug || "").toLowerCase().trim();
  if (!slug)
    throw Object.assign(new Error("A city slug is required."), {
      status: 400,
      code: "invalid_city",
    });

  const running = graphJobForCity(slug);
  if (running && running.status === "running") return running;

  const estimate = documentChunkEstimate(slug);
  if (!estimate.documents)
    throw Object.assign(
      new Error(
        `No ingested documents for "${slug}". Ingest the city's meetings and documents before building its graph.`,
      ),
      { status: 409, code: "no_documents" },
    );

  const id = randomUUID();
  const job = {
    job: id,
    citySlug: slug,
    place: clean(place, 120) || slug.replace(/-/g, " "),
    status: "running",
    stage: "extracting",
    documents: estimate.documents,
    chunksEstimated: estimate.chunks,
    chunksTotal: null,
    done: 0,
    failed: 0,
    emitted: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    counts: null,
    error: null,
  };
  jobs.set(id, job);
  byCity.set(slug, id);

  const args = [
    path.join(root, "scripts", "graph", "city-extract.mjs"),
    `--city=${slug}`,
    `--place=${job.place}`,
    `--concurrency=${Number(concurrency) || 6}`,
  ];
  if (Number(limit) > 0) args.push(`--limit=${Number(limit)}`);

  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  child.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.start) {
        job.chunksTotal = parsed.start.chunks;
        job.documents = parsed.start.documents;
      }
      if (parsed.progress) {
        job.done = parsed.progress.done;
        job.failed = parsed.progress.failed;
        job.emitted = parsed.progress.emitted;
        job.chunksTotal = parsed.progress.total;
      }
      if (parsed.result) {
        job.counts = parsed.result.counts;
        job.emitted = parsed.result.emitted_nodes;
      }
      if (parsed.error === "no_documents") job.error = "No documents to extract for this city.";
    }
  });

  const stderr = [];
  child.stderr.on("data", (data) => stderr.push(data.toString()));

  child.on("close", (code) => {
    job.finishedAt = new Date().toISOString();
    job.stage = "done";
    if (code === 0 && !job.error) {
      job.status = "done";
    } else {
      job.status = "failed";
      job.error = job.error || clean(stderr.join(" "), 400) || `Extraction exited with code ${code}.`;
    }
  });

  child.on("error", (error) => {
    job.status = "failed";
    job.stage = "done";
    job.error = clean(error?.message, 300);
    job.finishedAt = new Date().toISOString();
  });

  return job;
}
