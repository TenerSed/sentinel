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
      console.log(`seed validation passed: ${locations.length} configured locations`);
    } catch (error) {
      console.error(`seed validation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      database.close();
    }
  }
}
