import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { projectEvidenceForLocation } from "./evidence-contract.mjs";

const database = new Database("data/lamplighter.db", { readonly: true, fileMustExist: true });

try {
  const seedSource = fs.readFileSync("src/demo-seed.ts", "utf8");
  const match = seedSource.match(/export const demoSeed: DemoSeed = ([\s\S]+);\s*$/);
  assert.ok(match, "generated demo seed is readable");
  const seed = JSON.parse(match[1]);
  const expectedCoverage = {
    indy: ["federal", "indiana", "indy"],
    indiana: ["indiana"],
    federal: ["federal"],
  };
  for (const [locationId, expected] of Object.entries(expectedCoverage)) {
    const actual = seed.coverage.filter((coverage) => coverage.locationId === locationId).map((coverage) => coverage.coveredLocationId).sort();
    assert.deepEqual(actual, expected, `${locationId} coverage is exact`);
    const records = projectEvidenceForLocation(database, locationId);
    assert.ok(records.every((record) => expected.includes(record.locationId)), `${locationId} only projects configured coverage`);
    assert.deepEqual(records, [...records].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)), `${locationId} projection is deterministic`);
  }
  assert.deepEqual(seed.records, [...seed.records].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)), "browser seed is deterministic");
  assert.ok(seed.records.every((record) => record.locationId && record.updateType && record.sourceKind && record.publisher && record.title && record.exactQuote && record.canonicalUrl && record.locator), "records retain citation fields");
  assert.ok(seed.records.some((record) => record.sourceKind === "reporting"), "reporting stays explicit");
  assert.deepEqual(new Set(seed.records.map((record) => record.updateType)), new Set(["legislation", "office_holder", "policy"]), "all required update types exist");
  console.log("recent scope check passed");
} finally {
  database.close();
}
