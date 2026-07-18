import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDatabaseIntegrity,
  createDatabase,
  insert,
  insertEvidence,
  normalizeCanonicalUrl,
  projectEvidenceForLocation,
  validateEvidence,
} from "./evidence-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "data/seed-records.json");
const databasePath = path.join(root, "data/lamplighter.db");
const lockPath = path.join(root, "data/.seed.lock");

function sha256(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9-]+$/.test(value)) throw new Error(`${label} must be a stable lowercase ID`);
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function rawAsset(record, field = "rawPath", hashField = "contentHash") {
  const rawPath = record[field];
  if (rawPath == null) return null;
  if (typeof rawPath !== "string" || !rawPath.startsWith("data/raw/")) {
    throw new Error(`${record.id}: ${field} must stay under data/raw`);
  }
  const assetPath = path.resolve(root, rawPath);
  if (!assetPath.startsWith(path.join(root, "data/raw") + path.sep) || !fs.existsSync(assetPath)) {
    throw new Error(`${record.id}: ${field} asset is missing`);
  }
  const contents = fs.readFileSync(assetPath);
  if (sha256(contents) !== record[hashField]) throw new Error(`${record.id}: ${field} SHA-256 does not match registry`);
  return contents;
}

export function assertEvidenceQuoteInRawAsset(record) {
  const evidencePath = record.evidenceRawPath ?? record.rawPath;
  const evidenceHash = record.evidenceContentHash ?? record.contentHash;
  if (Number.isInteger(record.locator?.pageNumber) && !record.evidenceRawPath) {
    throw new Error(`${record.id}: page evidence requires a bundled page transcription`);
  }
  const raw = rawAsset({ ...record, evidenceRawPath: evidencePath, evidenceContentHash: evidenceHash }, "evidenceRawPath", "evidenceContentHash");
  const rawText = raw.toString("utf8");
  const timedText = Number.isInteger(record.locator?.startSeconds) && evidencePath.endsWith(".vtt")
    ? rawText.split(/\r?\n\r?\n/).flatMap((cue) => {
      const [timing, ...lines] = cue.split(/\r?\n/);
      const match = timing.match(/^(\d+):(\d{2})\.(\d{3}) --> (\d+):(\d{2})\.(\d{3})/);
      if (!match) return [];
      const start = Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000;
      const end = Number(match[4]) * 60 + Number(match[5]) + Number(match[6]) / 1000;
      return start >= record.locator.startSeconds && end <= record.locator.endSeconds ? [lines.join(" ")] : [];
    }).join(" ")
    : rawText;
  if (!timedText.includes(record.quote)) {
    throw new Error(`${record.id}: exact quote is absent from its bundled raw evidence`);
  }
}

export function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

export function validateFixture(fixture = loadFixture()) {
  if (fixture.version !== 1 || !Array.isArray(fixture.locations) || !Array.isArray(fixture.coverage) || !Array.isArray(fixture.sources) || !Array.isArray(fixture.sourceLocations) || !Array.isArray(fixture.records)) {
    throw new Error("fixture is missing required versioned arrays");
  }
  if (fixture.records.length < 12 || fixture.records.length > 20) throw new Error("fixture must contain 12–20 records");
  const locations = new Set(fixture.locations.map((location) => location.id));
  if (locations.size !== 3 || !["indy", "indiana", "federal"].every((id) => locations.has(id))) throw new Error("fixture must configure Indianapolis, Indiana, and federal locations");
  for (const location of fixture.locations) {
    assertId(location.id, "location ID");
    if (typeof location.label !== "string" || !location.label) throw new Error(`${location.id}: location label is required`);
  }
  const sourceById = new Map();
  for (const source of fixture.sources) {
    assertId(source.id, "source ID");
    if (sourceById.has(source.id)) throw new Error(`duplicate source: ${source.id}`);
    if (!['government_record', 'video_transcript', 'reporting'].includes(source.kind)) throw new Error(`${source.id}: invalid source kind`);
    normalizeCanonicalUrl(source.canonicalUrl);
    sourceById.set(source.id, source);
  }
  const permitted = new Set();
  for (const membership of fixture.sourceLocations) {
    if (!sourceById.has(membership.sourceId) || !locations.has(membership.locationId)) throw new Error("source location references an unknown source or location");
    permitted.add(`${membership.sourceId}:${membership.locationId}`);
  }
  const coveragePairs = new Set();
  for (const coverage of fixture.coverage) {
    if (!locations.has(coverage.locationId) || !locations.has(coverage.coveredLocationId)) throw new Error("coverage references an unknown location");
    const pair = `${coverage.locationId}:${coverage.coveredLocationId}`;
    if (coveragePairs.has(pair)) throw new Error(`duplicate coverage: ${pair}`);
    coveragePairs.add(pair);
  }
  for (const pair of ["indy:indy", "indy:indiana", "indy:federal", "indiana:indiana", "federal:federal"]) {
    if (!coveragePairs.has(pair)) throw new Error(`missing required coverage: ${pair}`);
  }
  if (coveragePairs.size !== 5) throw new Error("fixture coverage must not broaden direct selections");
  const ids = new Set();
  const sourceKinds = new Set();
  let hasPage = false;
  let hasTimestamp = false;
  for (const record of fixture.records) {
    assertId(record.id, "record ID");
    if (ids.has(record.id)) throw new Error(`duplicate record: ${record.id}`);
    ids.add(record.id);
    if (!sourceById.has(record.sourceId) || !locations.has(record.locationId) || !permitted.has(`${record.sourceId}:${record.locationId}`)) throw new Error(`${record.id}: source is not configured for its location`);
    if (record.sourceKind !== sourceById.get(record.sourceId).kind) throw new Error(`${record.id}: source kind mismatch`);
    if (!["legislation", "office_holder", "policy"].includes(record.updateType)) throw new Error(`${record.id}: invalid update type`);
    if (!["civic_update", "recent_public_position"].includes(record.evidenceKind)) throw new Error(`${record.id}: invalid evidence kind`);
    if (record.evidenceKind === "recent_public_position" && !["government_record", "video_transcript"].includes(record.sourceKind)) throw new Error(`${record.id}: recent public position needs a primary record or transcript`);
    sourceKinds.add(record.sourceKind);
    if (typeof record.title !== "string" || typeof record.sourceTitle !== "string" || !record.title || !record.sourceTitle) throw new Error(`${record.id}: titles are required`);
    assertTimestamp(record.publishedAt, `${record.id}: publishedAt`);
    assertTimestamp(record.retrievedAt, `${record.id}: retrievedAt`);
    if (typeof record.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.contentHash)) throw new Error(`${record.id}: contentHash must be SHA-256`);
    if (record.originalUrl !== record.canonicalUrl) throw new Error(`${record.id}: original and canonical URL must match this hand-verified fixture`);
    validateEvidence({ quote: record.quote, canonicalUrl: record.canonicalUrl, pageNumber: record.locator?.pageNumber, startSeconds: record.locator?.startSeconds, endSeconds: record.locator?.endSeconds });
    rawAsset(record);
    assertEvidenceQuoteInRawAsset(record);
    hasPage ||= Number.isInteger(record.locator?.pageNumber);
    hasTimestamp ||= Number.isInteger(record.locator?.startSeconds);
  }
  if (!hasPage || !hasTimestamp) throw new Error("fixture needs page and timestamp evidence");
  if (!["government_record", "video_transcript", "reporting"].every((kind) => sourceKinds.has(kind))) {
    throw new Error("fixture needs government records, video transcripts, and reporting");
  }
  if (!["legislation", "office_holder", "policy"].every((type) => fixture.records.some((record) => record.updateType === type))) {
    throw new Error("fixture needs legislation, office-holder, and policy updates");
  }
  return fixture;
}

function writeDatabase(fixture) {
  const temporaryPath = `${databasePath}.tmp-${process.pid}`;
  fs.rmSync(temporaryPath, { force: true });
  const database = createDatabase(temporaryPath);
  try {
    database.transaction(() => {
      for (const location of fixture.locations) insert(database, "locations", location);
      for (const coverage of fixture.coverage) insert(database, "location_coverage", { location_id: coverage.locationId, covered_location_id: coverage.coveredLocationId });
      for (const source of fixture.sources) insert(database, "sources", { id: source.id, publisher: source.publisher, kind: source.kind, canonical_url: source.canonicalUrl });
      for (const membership of fixture.sourceLocations) insert(database, "source_locations", { source_id: membership.sourceId, location_id: membership.locationId });
      for (const record of fixture.records) {
        const raw = rawAsset(record);
        const documentId = `document-${record.id}`;
        const evidenceId = `evidence-${record.id}`;
        const claimId = `claim-${record.id}`;
        insert(database, "documents", { id: documentId, source_id: record.sourceId, canonical_url: record.canonicalUrl, title: record.sourceTitle, published_at: record.publishedAt, retrieved_at: record.retrievedAt, content_hash: record.contentHash, raw_text: record.rawPath?.endsWith(".txt") ? raw.toString("utf8") : null });
        insertEvidence(database, { id: evidenceId, document_id: documentId, ordinal: 1, quote: record.quote, evidence_kind: record.evidenceKind, canonicalUrl: record.canonicalUrl, page_number: record.locator.pageNumber ?? null, start_seconds: record.locator.startSeconds ?? null, end_seconds: record.locator.endSeconds ?? null });
        insert(database, "updates", { id: record.id, document_id: documentId, location_id: record.locationId, update_type: record.updateType, title: record.title, published_at: record.publishedAt });
        insert(database, "claims", { id: claimId, update_id: record.id, text: record.quote });
        insert(database, "claim_evidence", { claim_id: claimId, evidence_id: evidenceId });
      }
      assertDatabaseIntegrity(database);
    })();
  } catch (error) {
    database.close();
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  database.close();
  return temporaryPath;
}

function writeDemoSeed(databaseFile, fixture) {
  const database = createDatabase(databaseFile);
  const byId = new Map();
  for (const location of fixture.locations) {
    for (const record of projectEvidenceForLocation(database, location.id)) byId.set(record.id, record);
  }
  database.close();
  const records = [...byId.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .map(({ pageNumber, startSeconds, endSeconds, ...record }) => record);
  const seed = { version: 1, locations: fixture.locations, coverage: fixture.coverage, records };
  const output = `import type { DemoSeed } from "./types";\n\nexport const demoSeed: DemoSeed = ${JSON.stringify(seed, null, 2)};\n`;
  fs.writeFileSync(path.join(root, "src/demo-seed.ts"), output);
}

export function seed() {
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch {
    throw new Error("seed is already running; remove data/.seed.lock only after confirming no writer is active");
  }
  try {
    const fixture = validateFixture();
    const temporaryPath = writeDatabase(fixture);
    fs.renameSync(temporaryPath, databasePath);
    writeDemoSeed(databasePath, fixture);
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) seed();
