// Learned extractors for unknown civic-data endpoints.
//
// Legistar, CivicClerk and PrimeGov each needed a hand-written field mapping.
// That does not scale: there are dozens of municipal vendors and every city we
// have never seen is a new one. This module removes the hand-written step.
//
// Given any JSON endpoint that a probe already verified, it:
//   1. samples real records and computes a structural summary of their shape,
//   2. asks a model to write a field mapping from that shape to our schema,
//   3. VERIFIES the mapping by executing it against the real sample rows,
//   4. persists it only if it actually extracts data.
//
// Step 3 is the important one. The model proposes; plain code decides. A
// mapping that names a field that does not exist, or yields blank titles or
// unparseable dates, is rejected no matter how confident the model was.

import { openCityDb } from "./city.mjs";
import { safeFetch } from "./safe-fetch.mjs";

const SAMPLE_ROWS = 6;
const LLM_TIMEOUT_MS = 45_000;

const clean = (value, max = 300) =>
  String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Resolves "a.b.c" against an object. Returns undefined rather than throwing so
// a bad path proposed by the model simply fails validation.
export function readPath(row, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .reduce((value, key) => (value == null ? undefined : value[key]), row);
}

/**
 * Finds the array of records inside an arbitrary JSON response. Vendors put it
 * at the root (PrimeGov, Legistar), under `value` (OData/CivicClerk), or under
 * some other single key. We look at most two levels deep.
 */
export function findRecordPath(body) {
  if (Array.isArray(body)) return { path: "", rows: body };
  if (!body || typeof body !== "object") return { path: null, rows: [] };
  for (const [key, value] of Object.entries(body))
    if (Array.isArray(value) && value.length && typeof value[0] === "object")
      return { path: key, rows: value };
  for (const [key, value] of Object.entries(body)) {
    if (!value || typeof value !== "object") continue;
    for (const [inner, nested] of Object.entries(value))
      if (Array.isArray(nested) && nested.length && typeof nested[0] === "object")
        return { path: `${key}.${inner}`, rows: nested };
  }
  return { path: null, rows: [] };
}

/**
 * Structural summary of sample records: every key path, its type, and a couple
 * of real example values. This is what the model reasons over — far smaller
 * than the raw payload, and it keeps the model's attention on shape.
 */
export function describeShape(rows, maxDepth = 2) {
  const fields = new Map();
  const visit = (value, prefix, depth) => {
    if (!value || typeof value !== "object" || depth > maxDepth) return;
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const type = Array.isArray(item)
        ? "array"
        : item === null
          ? "null"
          : typeof item;
      const entry = fields.get(path) || { path, type, examples: [], arrayOf: null };
      if (entry.type === "null" && type !== "null") entry.type = type;
      if (type !== "object" && type !== "array" && entry.examples.length < 2) {
        const sample = clean(item, 80);
        if (sample && !entry.examples.includes(sample)) entry.examples.push(sample);
      }
      if (Array.isArray(item) && item.length && typeof item[0] === "object" && !entry.arrayOf)
        entry.arrayOf = Object.keys(item[0]).slice(0, 18);
      fields.set(path, entry);
      if (!Array.isArray(item) && typeof item === "object")
        visit(item, path, depth + 1);
    }
  };
  for (const row of rows.slice(0, SAMPLE_ROWS)) visit(row, "", 0);
  return [...fields.values()].slice(0, 90);
}

/**
 * Runs a mapping against one raw record. Pure code — no model involvement — so
 * ingest behaviour is fully determined by the stored mapping.
 */
export function applyAdapter(mapping, row) {
  const eventId = readPath(row, mapping?.fields?.event_id);
  const title = clean(readPath(row, mapping?.fields?.title), 300);
  const body = clean(readPath(row, mapping?.fields?.body), 300) || title;
  const startRaw = readPath(row, mapping?.fields?.start_datetime);
  const start = clean(startRaw, 80);
  const documents = [];
  const listPath = mapping?.documents?.list_path;
  if (listPath) {
    const list = readPath(row, listPath);
    if (Array.isArray(list))
      for (const file of list) {
        const filter = mapping.documents.filter;
        if (filter?.field && String(readPath(file, filter.field)) !== String(filter.equals))
          continue;
        const id = readPath(file, mapping.documents.id_field);
        if (id == null) continue;
        documents.push({
          id: String(id),
          name: clean(readPath(file, mapping.documents.name_field), 200) || "Document",
          url: mapping.documents.url_template
            ? String(mapping.documents.url_template).replace(/\{id\}/g, String(id))
            : null,
        });
      }
  }
  return {
    event_id: eventId == null ? null : String(eventId),
    title,
    body,
    start_datetime: start,
    start_parsed: start && !Number.isNaN(Date.parse(start)) ? new Date(start).toISOString() : null,
    documents,
  };
}

/**
 * Executes a proposed mapping against the real sample and scores it. This is
 * the gate: a mapping is only ever trusted because it demonstrably worked on
 * records fetched from the live endpoint, never because a model asserted it.
 */
export function validateAdapter(mapping, rows) {
  const sample = rows.slice(0, SAMPLE_ROWS);
  const extracted = sample.map((row) => applyAdapter(mapping, row));
  const total = extracted.length || 1;
  const withId = extracted.filter((item) => item.event_id).length;
  const withTitle = extracted.filter((item) => item.title).length;
  const withDate = extracted.filter((item) => item.start_parsed).length;
  const withDocs = extracted.filter((item) => item.documents.length).length;
  const checks = [
    { name: "event_id present", pass: withId / total >= 0.8, detail: `${withId}/${total} records` },
    { name: "title non-empty", pass: withTitle / total >= 0.8, detail: `${withTitle}/${total} records` },
    {
      name: "start date parses",
      pass: withDate / total >= 0.5,
      detail: `${withDate}/${total} records parsed as a real date`,
    },
  ];
  return {
    valid: checks.every((check) => check.pass),
    checks,
    documentsFound: withDocs,
    preview: extracted.slice(0, 3).map((item) => ({
      event_id: item.event_id,
      title: item.title,
      start: item.start_parsed || item.start_datetime || null,
      documents: item.documents.length,
    })),
  };
}

async function callModel(prompt) {
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/local/sentinel",
        "x-title": "Sentinel Adapter Synthesis",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
        reasoning: { enabled: false },
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write field mappings for unknown JSON APIs. Return JSON only. Use only field paths that appear in the provided schema; the caller executes your mapping against real records and rejects it if it does not extract data.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    return JSON.parse(String(body?.choices?.[0]?.message?.content || "{}"));
  } finally {
    clearTimeout(timer);
  }
}

function mappingPrompt(shape, endpointUrl, recordPath, attemptNote) {
  const lines = shape.map((field) => {
    const examples = field.examples.length ? ` e.g. ${field.examples.join(" | ")}` : "";
    const nested = field.arrayOf ? ` [array of objects with keys: ${field.arrayOf.join(", ")}]` : "";
    return `- ${field.path} (${field.type})${nested}${examples}`;
  });
  return `An unknown municipal meetings API returned records from:
${endpointUrl}

Records live at path: ${recordPath || "(root array)"}

Observed record schema (real field paths and real example values):
${lines.join("\n")}

Write a mapping from this schema to our canonical meeting schema. Return strict JSON:
{
  "vendor_guess": "short name for this vendor if recognisable, else 'unknown'",
  "fields": {
    "event_id": "path to a stable unique id for the meeting",
    "title": "path to the meeting name/title",
    "body": "path to the committee/board name, or repeat the title path",
    "start_datetime": "path to the meeting start date-time"
  },
  "documents": {
    "list_path": "path to the array of attached agenda/minutes documents, or null",
    "id_field": "field inside that array holding the document id, or null",
    "name_field": "field inside that array holding the document name, or null",
    "url_template": "absolute URL template for downloading a document with {id} as the placeholder, or null",
    "filter": null
  },
  "confidence": 0.0
}

Rules: every path must be one that appears in the schema above (dot notation for nesting). Do not invent fields. If there is no document array, set every value inside "documents" to null. "filter" may be {"field":"...","equals":<value>} to select only one document variant.${attemptNote ? `\n\nA previous attempt failed validation: ${attemptNote}. Choose different field paths.` : ""}`;
}

/**
 * Full synthesis loop for one endpoint. Retries once with the failure reason fed
 * back, then gives up honestly rather than storing a mapping that does not work.
 */
export async function synthesizeAdapter(endpointUrl, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  emit("sample", { url: endpointUrl, message: "Fetching a live sample from the endpoint." });

  // safeFetch: caller-supplied URL, so vendor-host allowlist + private-address
  // rejection + per-hop redirect revalidation all apply.
  const response = await safeFetch(endpointUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Endpoint returned HTTP ${response.status}.`);
  const body = await response.json();
  const { path: recordPath, rows } = findRecordPath(body);
  if (!rows.length) throw new Error("The endpoint returned no records to learn from.");
  emit("sample", {
    url: endpointUrl,
    recordPath,
    recordCount: rows.length,
    message: `Found ${rows.length} records at ${recordPath ? `"${recordPath}"` : "the response root"}.`,
  });

  const shape = describeShape(rows);
  emit("shape", {
    fieldCount: shape.length,
    fields: shape.slice(0, 24),
    message: `Described ${shape.length} distinct field paths across ${Math.min(rows.length, SAMPLE_ROWS)} sample records.`,
  });

  let note = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    emit("synthesize", { attempt, message: "Writing a field mapping for this schema." });
    let mapping;
    try {
      mapping = await callModel(mappingPrompt(shape, endpointUrl, recordPath, note));
    } catch (error) {
      emit("synthesize", { attempt, ok: false, message: `Model call failed: ${clean(error?.message, 160)}` });
      note = clean(error?.message, 120);
      continue;
    }
    mapping.record_path = recordPath;
    mapping.endpoint = endpointUrl;
    emit("synthesize", {
      attempt,
      ok: true,
      mapping,
      message: `Proposed mapping for vendor "${clean(mapping.vendor_guess, 40) || "unknown"}".`,
    });

    const verdict = validateAdapter(mapping, rows);
    emit("verify", {
      attempt,
      valid: verdict.valid,
      checks: verdict.checks,
      preview: verdict.preview,
      documentsFound: verdict.documentsFound,
      message: verdict.valid
        ? "Mapping executed against the real sample and extracted usable records."
        : `Mapping rejected: ${verdict.checks.filter((check) => !check.pass).map((check) => check.name).join(", ")}.`,
    });
    if (verdict.valid) {
      saveAdapter(endpointUrl, mapping, verdict, options.citySlug);
      emit("saved", { message: "Mapping stored; this vendor no longer needs hand-written code." });
      return { mapping, verdict };
    }
    note = verdict.checks
      .filter((check) => !check.pass)
      .map((check) => `${check.name} (${check.detail})`)
      .join("; ");
  }
  throw new Error(`No mapping passed validation for this endpoint. Last failure: ${note}`);
}

export function saveAdapter(endpointUrl, mapping, verdict, citySlugValue) {
  const db = openCityDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS learned_adapters (
      endpoint TEXT PRIMARY KEY,
      city_slug TEXT,
      vendor_guess TEXT,
      mapping_json TEXT NOT NULL,
      verdict_json TEXT NOT NULL,
      learned_at TEXT NOT NULL
    )`);
    db.prepare(
      `INSERT INTO learned_adapters (endpoint,city_slug,vendor_guess,mapping_json,verdict_json,learned_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET
        city_slug=excluded.city_slug, vendor_guess=excluded.vendor_guess,
        mapping_json=excluded.mapping_json, verdict_json=excluded.verdict_json,
        learned_at=excluded.learned_at`,
    ).run(
      endpointUrl,
      citySlugValue || null,
      clean(mapping?.vendor_guess, 60) || "unknown",
      JSON.stringify(mapping),
      JSON.stringify(verdict),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

export function loadAdapter(endpointUrl) {
  const db = openCityDb();
  try {
    const row = db
      .prepare("SELECT mapping_json FROM learned_adapters WHERE endpoint = ?")
      .get(endpointUrl);
    return row ? JSON.parse(row.mapping_json) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
