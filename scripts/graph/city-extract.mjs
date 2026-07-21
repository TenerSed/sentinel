// Per-city graph extraction.
//
// scripts/graph/extract.mjs builds the Fishers graph from `cc_files` and
// YouTube transcripts. This script does the same for any ONBOARDED city, using
// the documents the onboarding pipeline ingested into `onboarded_documents`.
//
// The important difference is key scoping. The Fishers extractor merges on a
// bare key (`Person {name}`, `Case {case_number}`), which is safe for a single
// city and wrong for many: a "John Smith" in Tampa would silently merge into a
// "John Smith" in Fishers, and two cities using case number "RZ-25-1" would
// collapse into one node. Every node written here is keyed by `gkey`, which is
// `<city_slug>:<natural key>`, and carries `city_slug` for filtering. Fishers
// nodes are untouched and keep their original keys.
//
// Usage: node scripts/graph/city-extract.mjs --city=tampa [--limit=N] [--concurrency=N]

import Database from "better-sqlite3";
import { graphDriver } from "./lib/neo4j.mjs";
import { NODE_KEYS, NODE_LABELS, REL_TYPES, normalizeName, normalizeCase } from "./schema.mjs";
import { extractPlace } from "./lib/llm.mjs";
import { resolveRuntimeDbPath } from "../../server/city.mjs";

const argv = process.argv.slice(2);
const arg = (name) => argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const citySlug = String(arg("city") || "").toLowerCase().trim();
const limit = Number(arg("limit")) || Infinity;
const CONCURRENCY = Number(arg("concurrency")) || Number(process.env.EXTRACT_CONCURRENCY) || 8;
const extractor = `llm-city:${citySlug}`;
// Named in the prompt so the model knows which jurisdiction's entities to look
// for; the original prompt hardcoded "Fishers" and extracted nothing elsewhere.
const placeName = arg("place") || citySlug.replace(/-/g, " ");

if (!citySlug) {
  console.error("Usage: node scripts/graph/city-extract.mjs --city=<slug> [--limit=N]");
  process.exit(1);
}

const db = new Database(resolveRuntimeDbPath());
db.exec(
  `CREATE TABLE IF NOT EXISTS graph_extract_log (
     source_id TEXT NOT NULL, chunk_ordinal INTEGER NOT NULL, extractor TEXT NOT NULL,
     processed_at TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
     PRIMARY KEY(source_id,chunk_ordinal,extractor))`,
);
const driver = graphDriver();

// 3k chunks, not the 6k the Fishers extractor uses. At 6000 characters the
// model reliably returned an empty node list for dense agenda text; at 3000 the
// same text extracts cases, applicants and zoning codes.
function chunks(text) {
  const out = [];
  for (let start = 0, ordinal = 0; start < text.length; start += 2700, ordinal += 1)
    out.push({ ordinal, text: text.slice(start, start + 3000), start });
  return out;
}

// OpenRouter's json_object mode enforces no schema, so the model freely returns
// {id, properties} instead of {key, props}. The Fishers loader only understood
// the latter and silently dropped every node. Accept both shapes.
const nodeProps = (node) => node?.props || node?.properties || {};

function naturalKey(node) {
  const props = nodeProps(node);
  let key =
    node.key ||
    props[NODE_KEYS[node.label]] ||
    props.name ||
    props.case_number ||
    props.title ||
    props.code ||
    props.address ||
    props.folio;
  if (node.label === "Person" || node.label === "Organization") key = normalizeName(key);
  if (node.label === "Case") key = normalizeCase(key);
  return String(key || "").trim();
}

// City-scoped merge key. Without this, entities from different cities collide.
const scopedKey = (node) => {
  const key = naturalKey(node);
  return key ? `${citySlug}:${key}` : "";
};

function sanitizeProps(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (v == null) continue;
    if (Array.isArray(v))
      out[k] = v.every((x) => x == null || typeof x !== "object")
        ? v.filter((x) => x != null)
        : JSON.stringify(v);
    else if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

async function document(session, ctx) {
  await session.run(
    `MERGE (d:Document {doc_id:$doc_id})
     SET d.source=$source, d.title=$title, d.url=$url, d.source_id=$source_id,
         d.extractor=$extractor, d.city_slug=$city_slug, d.confidence=1.0`,
    {
      doc_id: ctx.doc_id,
      source: ctx.source,
      title: ctx.title,
      url: ctx.url ?? null,
      source_id: String(ctx.source_id),
      extractor: ctx.extractor,
      city_slug: citySlug,
    },
  );
}

async function load(session, result, ctx) {
  // Relationship endpoints may be {label,key}, {label,properties}, or a bare
  // string referencing a node's synthetic id. Index the nodes so all three work.
  const byId = new Map();
  for (const node of result.nodes || [])
    if (node?.id != null) byId.set(String(node.id), node);
  const endpoint = (value) => {
    if (value == null) return null;
    if (typeof value === "string") return byId.get(value) || null;
    if (typeof value === "object") {
      if (value.label && NODE_LABELS.has(value.label)) return value;
      if (value.id != null) return byId.get(String(value.id)) || null;
    }
    return null;
  };

  for (const node of result.nodes || []) {
    if (!NODE_LABELS.has(node.label)) continue;
    const gkey = scopedKey(node);
    if (!gkey) continue;
    const property = NODE_KEYS[node.label];
    const props = {
      ...nodeProps(node),
      [property]: naturalKey(node),
      gkey,
      city_slug: citySlug,
      source: ctx.source,
      source_id: String(ctx.source_id),
      extractor: ctx.extractor,
      confidence: node.props?.confidence ?? 0.8,
    };
    if (props.char_start != null) props.char_start += ctx.char_start || 0;
    if (props.char_end != null) props.char_end += ctx.char_start || 0;
    await session.run(`MERGE (n:${node.label} {gkey:$gkey}) SET n += $props`, {
      gkey,
      props: sanitizeProps(props),
    });
    // Tie every entity back to the document it came from, so the UI can always
    // show a receipt for why a node exists.
    await session.run(
      `MATCH (n:${node.label} {gkey:$gkey}), (d:Document {doc_id:$doc_id})
       MERGE (n)-[r:EVIDENCED_BY]->(d) SET r.city_slug=$city_slug, r.extractor=$extractor`,
      { gkey, doc_id: ctx.doc_id, city_slug: citySlug, extractor: ctx.extractor },
    );
  }
  for (const rel of result.relationships || []) {
    if (!REL_TYPES.has(rel.type)) continue;
    const from = endpoint(rel.from);
    const to = endpoint(rel.to);
    if (!from || !to) continue;
    if (!NODE_LABELS.has(from.label) || !NODE_LABELS.has(to.label)) continue;
    const fk = scopedKey(from);
    const tk = scopedKey(to);
    if (!fk || !tk) continue;
    const props = {
      ...(rel.props || rel.properties || {}),
      city_slug: citySlug,
      source: ctx.source,
      source_id: String(ctx.source_id),
      extractor: ctx.extractor,
      confidence: rel.props?.confidence ?? 0.8,
    };
    if (props.char_start != null) props.char_start += ctx.char_start || 0;
    if (props.char_end != null) props.char_end += ctx.char_start || 0;
    await session.run(
      `MATCH (a:${from.label} {gkey:$fk}), (b:${to.label} {gkey:$tk})
       MERGE (a)-[r:${rel.type}]->(b) SET r += $props`,
      { fk, tk, props: sanitizeProps(props) },
    );
  }
}

// Minutes first — votes, motions and named people carry the most signal.
const rows = db
  .prepare(
    `SELECT file_id AS source_id, event_id, file_type, name AS title, source_url AS url, plaintext AS text
     FROM onboarded_documents
     WHERE city_slug = ? AND length(trim(coalesce(plaintext,''))) > 0
     ORDER BY CASE WHEN lower(coalesce(file_type,'')) LIKE '%minute%' THEN 0 ELSE 1 END, chars DESC`,
  )
  .all(citySlug);

if (!rows.length) {
  console.log(JSON.stringify({ city: citySlug, error: "no_documents", processed: 0 }));
  db.close();
  await driver.close();
  process.exit(0);
}

const units = rows.flatMap((row) =>
  chunks(row.text).map((chunk) => ({
    ...row,
    source: /minute/i.test(row.file_type || "") ? "minutes" : "agenda",
    doc_id: `city:${citySlug}:file:${row.source_id}`,
    ...chunk,
  })),
);

const isDone = db.prepare(
  "SELECT 1 FROM graph_extract_log WHERE source_id=? AND chunk_ordinal=? AND extractor=? AND status='ok'",
);
const pending = units
  .filter((unit) => !isDone.get(String(unit.source_id), unit.ordinal, extractor))
  .slice(0, limit === Infinity ? undefined : limit);

const logRow = db.prepare("INSERT OR REPLACE INTO graph_extract_log VALUES (?,?,?,?,?,?)");
let done = 0,
  emitted = 0,
  failed = 0,
  next = 0;
const total = pending.length;

async function worker() {
  const session = driver.session();
  try {
    while (next < pending.length) {
      const unit = pending[next++];
      const ctx = { ...unit, extractor };
      try {
        await document(session, ctx);
        // The model intermittently returns an empty node list for text that
        // clearly contains entities; one retry recovers most of those chunks.
        let result = await extractPlace(unit.text, placeName);
        if (!(result?.nodes || []).length)
          result = await extractPlace(unit.text, placeName);
        await load(session, result, ctx);
        logRow.run(String(unit.source_id), unit.ordinal, extractor, new Date().toISOString(), "ok", null);
        done += 1;
        emitted += result.nodes?.length || 0;
      } catch (error) {
        logRow.run(
          String(unit.source_id),
          unit.ordinal,
          extractor,
          new Date().toISOString(),
          "error",
          String(error.message).slice(0, 300),
        );
        failed += 1;
      }
      // Progress on stdout as JSON so the job runner can parse it live.
      console.log(
        JSON.stringify({ progress: { done, failed, total, emitted, city: citySlug } }),
      );
    }
  } finally {
    await session.close();
  }
}

async function cityCounts() {
  const session = driver.session();
  try {
    const nodes = await session.run(
      "MATCH (n {city_slug:$slug}) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC",
      { slug: citySlug },
    );
    const rels = await session.run(
      "MATCH ()-[r {city_slug:$slug}]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC",
      { slug: citySlug },
    );
    return {
      nodes: nodes.records.map((r) => ({ label: r.get("label"), count: r.get("count").toNumber() })),
      relationships: rels.records.map((r) => ({ type: r.get("type"), count: r.get("count").toNumber() })),
    };
  } finally {
    await session.close();
  }
}

try {
  console.log(
    JSON.stringify({ start: { city: citySlug, documents: rows.length, chunks: total, concurrency: CONCURRENCY } }),
  );
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total || 1) }, worker));
  console.log(
    JSON.stringify({ result: { city: citySlug, processed: done, failed, emitted_nodes: emitted, counts: await cityCounts() } }),
  );
} finally {
  db.close();
  await driver.close();
}
