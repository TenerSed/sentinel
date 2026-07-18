import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { normalizeCanonicalUrl } from "./evidence-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxBytes = 1_000_000;

if (process.argv.includes("--help")) {
  console.log("Usage: npm run import\nFetch each configured public source into data/imports.db. Fetched material stays draft-only until a later evidence extraction step.");
  process.exit(0);
}

const fixture = JSON.parse(fs.readFileSync(path.join(root, "data/seed-records.json"), "utf8"));
const allowlist = JSON.parse(fs.readFileSync(path.join(root, "data/import-sources.json"), "utf8"));
const locations = new Set(fixture.locations.map(({ id }) => id));
const memberships = new Set(fixture.sourceLocations.map(({ sourceId, locationId }) => `${sourceId}:${locationId}`));

function now() {
  return new Date().toISOString();
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function assertSource(source) {
  const configuredUrl = normalizeCanonicalUrl(source.url);
  const host = new URL(configuredUrl).hostname;
  if (!source?.id || !source?.locationId || !Array.isArray(source.allowedHosts) || !source.allowedHosts.includes(host) || !locations.has(source.locationId) || !memberships.has(`${source.id}:${source.locationId}`)) {
    throw new Error(`invalid allowlisted source: ${source?.id ?? "unknown"}`);
  }
  return configuredUrl;
}

function assertAllowedUrl(value, source) {
  const canonicalUrl = normalizeCanonicalUrl(value);
  if (!source.allowedHosts.includes(new URL(canonicalUrl).hostname)) throw new Error(`redirect outside allowlist: ${canonicalUrl}`);
  return canonicalUrl;
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`response exceeds ${maxBytes} byte limit`);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`response exceeds ${maxBytes} byte limit`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function fetchAllowed(source, configuredUrl) {
  let currentUrl = configuredUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    currentUrl = assertAllowedUrl(currentUrl, source);
    const response = await fetch(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect missing location");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { canonicalUrl: assertAllowedUrl(currentUrl, source), bytes: await readBounded(response) };
  }
  throw new Error("too many redirects");
}

function openImportDatabase() {
  const database = new Database(path.join(root, "data/imports.db"));
  database.exec(`
    CREATE TABLE IF NOT EXISTS import_attempts (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      original_url TEXT,
      canonical_url TEXT,
      content_hash TEXT,
      retrieved_at TEXT NOT NULL,
      result TEXT NOT NULL,
      diagnostic TEXT
    );
    CREATE TABLE IF NOT EXISTS imported_documents (
      canonical_url TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      original_url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      body BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS import_drafts (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      original_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      diagnostic TEXT NOT NULL,
      body BLOB NOT NULL,
      UNIQUE(canonical_url),
      UNIQUE(content_hash)
    );
  `);
  return database;
}

function attempt(database, row) {
  database.prepare(`INSERT INTO import_attempts (source_id, location_id, original_url, canonical_url, content_hash, retrieved_at, result, diagnostic)
    VALUES (@sourceId, @locationId, @originalUrl, @canonicalUrl, @contentHash, @retrievedAt, @result, @diagnostic)`).run(row);
}

function processFetched(database, source, configuredUrl, fetched) {
  const contentHash = sha256(fetched.bytes);
  const retrievedAt = now();
  const base = { sourceId: source.id, locationId: source.locationId, originalUrl: configuredUrl, canonicalUrl: fetched.canonicalUrl, contentHash, retrievedAt };
  const duplicateUrl = database.prepare("SELECT 1 FROM imported_documents WHERE canonical_url = ? UNION ALL SELECT 1 FROM import_drafts WHERE canonical_url = ? LIMIT 1").get(fetched.canonicalUrl, fetched.canonicalUrl);
  if (duplicateUrl) return attempt(database, { ...base, result: "duplicate-url", diagnostic: "canonical URL already imported" });
  const duplicateHash = database.prepare("SELECT 1 FROM imported_documents WHERE content_hash = ? UNION ALL SELECT 1 FROM import_drafts WHERE content_hash = ? LIMIT 1").get(contentHash, contentHash);
  if (duplicateHash) return attempt(database, { ...base, result: "duplicate-content", diagnostic: "content hash already imported" });
  database.prepare(`INSERT INTO import_drafts (source_id, location_id, original_url, canonical_url, content_hash, retrieved_at, diagnostic, body)
    VALUES (@sourceId, @locationId, @originalUrl, @canonicalUrl, @contentHash, @retrievedAt, @diagnostic, @body)`).run({
    ...base,
    diagnostic: "No validated exact quote and page/timestamp locator; retained as non-renderable draft.",
    body: fetched.bytes,
  });
  attempt(database, { ...base, result: "draft", diagnostic: "No validated evidence payload" });
}

const database = openImportDatabase();
let failures = 0;
try {
  for (const source of allowlist.sources ?? []) {
    let configuredUrl = source?.url ?? null;
    try {
      configuredUrl = assertSource(source);
      const fetched = await fetchAllowed(source, configuredUrl);
      database.transaction(() => processFetched(database, source, configuredUrl, fetched))();
      console.log(`${source.id}: imported as draft`);
    } catch (error) {
      failures += 1;
      const diagnostic = error instanceof Error ? error.message : String(error);
      try {
        attempt(database, {
          sourceId: source?.id ?? "unknown",
          locationId: source?.locationId ?? "unknown",
          originalUrl: configuredUrl,
          canonicalUrl: null,
          contentHash: null,
          retrievedAt: now(),
          result: "failed",
          diagnostic,
        });
      } catch (storageError) {
        console.error(`${source?.id ?? "unknown"}: ${diagnostic}; could not store failure: ${storageError instanceof Error ? storageError.message : String(storageError)}`);
        continue;
      }
      console.error(`${source?.id ?? "unknown"}: ${diagnostic}`);
    }
  }
} finally {
  database.close();
}
if (failures) process.exitCode = 1;
