import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  assertDatabaseIntegrity,
  projectEvidenceForLocation,
  validateEvidence,
} from "./evidence-contract.mjs";
import { validateFixture } from "./seed.mjs";

const databasePath = path.resolve("data/lamplighter.db");
const expectMissing = process.argv.includes("--expect-missing");
const validateFixtures = process.argv.includes("--validate-fixtures");

function readDemoSeed() {
  const source = fs.readFileSync(path.resolve("src/demo-seed.ts"), "utf8");
  const match = source.match(/export const demoSeed: DemoSeed = ([\s\S]+);\s*$/);
  if (!match) throw new Error("generated demo seed is unreadable");
  return JSON.parse(match[1]);
}

function assertSeedMatchesDatabase(database, fixture) {
  const seed = readDemoSeed();
  if (seed.version !== 1 || !Array.isArray(seed.locations) || !Array.isArray(seed.coverage) || !Array.isArray(seed.records)) {
    throw new Error("generated demo seed has an invalid shape");
  }
  const coverageKey = (coverage) => `${coverage.locationId}:${coverage.coveredLocationId}`;
  const expectedCoverage = database.prepare("SELECT location_id AS locationId, covered_location_id AS coveredLocationId FROM location_coverage").all();
  if (JSON.stringify(seed.locations) !== JSON.stringify(fixture.locations) || [seed.coverage, fixture.coverage, expectedCoverage].some((coverage) => coverage.map(coverageKey).sort().join(",") !== fixture.coverage.map(coverageKey).sort().join(","))) {
    throw new Error("generated demo seed locations or coverage disagree with SQLite");
  }
  const databaseRecords = database.prepare(`
    SELECT u.id, u.location_id AS locationId, l.label AS locationLabel, u.update_type AS updateType,
      s.kind AS sourceKind, s.publisher AS publisher, d.title AS sourceTitle, u.title, u.published_at AS publishedAt,
      d.canonical_url AS canonicalUrl, e.quote AS exactQuote, e.evidence_kind AS evidenceKind, e.page_number AS pageNumber,
      e.start_seconds AS startSeconds, e.end_seconds AS endSeconds
    FROM updates u JOIN documents d ON d.id = u.document_id JOIN sources s ON s.id = d.source_id
      JOIN locations l ON l.id = u.location_id JOIN evidence e ON e.document_id = d.id
    ORDER BY u.published_at DESC, u.id ASC, e.ordinal ASC
  `).all();
  if (seed.records.length !== databaseRecords.length) throw new Error("generated demo seed record count disagrees with SQLite");
  for (let index = 0; index < databaseRecords.length; index += 1) {
    const expected = databaseRecords[index];
    const actual = seed.records[index];
    if (!actual || actual.id !== expected.id || actual.locationId !== expected.locationId || actual.locationLabel !== expected.locationLabel || actual.updateType !== expected.updateType || actual.sourceKind !== expected.sourceKind || actual.publisher !== expected.publisher || actual.sourceTitle !== expected.sourceTitle || actual.title !== expected.title || actual.publishedAt !== expected.publishedAt || actual.canonicalUrl !== expected.canonicalUrl || actual.exactQuote !== expected.exactQuote || actual.evidenceKind !== expected.evidenceKind) {
      throw new Error(`generated demo seed record ${expected.id} disagrees with SQLite`);
    }
    validateEvidence({ quote: actual.exactQuote, canonicalUrl: actual.canonicalUrl, pageNumber: actual.locator?.pageNumber, startSeconds: actual.locator?.startSeconds, endSeconds: actual.locator?.endSeconds });
    if (!["legislation", "office_holder", "policy"].includes(actual.updateType)) throw new Error(`${actual.id}: generated seed has invalid update type`);
    if (!["civic_update", "recent_public_position"].includes(actual.evidenceKind)) throw new Error(`${actual.id}: generated seed has invalid evidence kind`);
    if (Object.hasOwn(actual, "rawText") || Object.hasOwn(actual, "contentHash")) throw new Error(`${actual.id}: generated seed exposes server-only data`);
  }
  if (!["legislation", "office_holder", "policy"].every((type) => seed.records.some((record) => record.updateType === type))) {
    throw new Error("generated demo seed lacks a required update type");
  }
}

if (validateFixtures) {
  try {
    validateFixture();
    console.log("fixture validation passed");
  } catch (error) {
    console.error(`fixture validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (!validateFixtures && !fs.existsSync(databasePath)) {
  const message = `seed database is missing: ${databasePath}`;
  console.error(message);
  if (expectMissing) process.exit(0);
  process.exitCode = 1;
} else if (!validateFixtures) {
  if (expectMissing) {
    console.error(`expected missing seed database but found: ${databasePath}`);
    process.exitCode = 1;
  } else {
    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      const fixture = validateFixture();
      database.pragma("foreign_keys = ON");
      assertDatabaseIntegrity(database);
      const locations = database.prepare("SELECT id FROM locations ORDER BY id").all();
      const unsupportedUpdates = database.prepare(`
        SELECT u.id
        FROM updates u
        LEFT JOIN evidence e ON e.document_id = u.document_id
        WHERE e.id IS NULL
      `).all();
      if (unsupportedUpdates.length) {
        throw new Error(`updates without evidence: ${unsupportedUpdates.map(({ id }) => id).join(", ")}`);
      }
      const updates = database.prepare(`
        SELECT e.quote, d.canonical_url AS canonicalUrl, e.page_number AS pageNumber,
          e.start_seconds AS startSeconds, e.end_seconds AS endSeconds
        FROM updates u
        JOIN documents d ON d.id = u.document_id
        JOIN evidence e ON e.document_id = d.id
      `).all();
      for (const update of updates) validateEvidence(update);
      for (const location of locations) projectEvidenceForLocation(database, location.id);
      assertSeedMatchesDatabase(database, fixture);
      console.log(`seed validation passed: ${locations.length} configured locations`);
    } catch (error) {
      console.error(`seed validation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      database.close();
    }
  }
}
