import assert from "node:assert/strict";
import {
  assertDatabaseIntegrity,
  createDatabase,
  insert,
  insertEvidence,
  projectEvidenceForLocation,
  validateEvidence,
} from "./evidence-contract.mjs";

assert.doesNotThrow(() => validateEvidence({
  quote: "The council adopted the ordinance after public comment.",
  canonicalUrl: "https://example.gov/minutes#page=4",
  pageNumber: 4,
}));
for (const invalid of [
  { quote: "", canonicalUrl: "https://example.gov", pageNumber: 1 },
  { quote: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six", canonicalUrl: "https://example.gov", pageNumber: 1 },
  { quote: "A supported fact.", canonicalUrl: "http://example.gov", pageNumber: 1 },
  { quote: "A supported fact.", canonicalUrl: "https://example.gov" },
  { quote: "A supported fact.", canonicalUrl: "https://example.gov", pageNumber: 1, startSeconds: 2 },
]) assert.throws(() => validateEvidence(invalid));

const database = createDatabase();
for (const location of [
  { id: "indy", label: "Indianapolis" },
  { id: "indiana", label: "Indiana" },
  { id: "federal", label: "U.S. federal" },
]) insert(database, "locations", location);
for (const coverage of [
  { location_id: "indy", covered_location_id: "indy" },
  { location_id: "indy", covered_location_id: "indiana" },
  { location_id: "indiana", covered_location_id: "indiana" },
  { location_id: "federal", covered_location_id: "federal" },
]) insert(database, "location_coverage", coverage);
insert(database, "sources", { id: "source-indiana", publisher: "Indiana", kind: "government_record", canonical_url: "https://example.gov/source" });
insert(database, "source_locations", { source_id: "source-indiana", location_id: "indiana" });
insert(database, "documents", { id: "doc", source_id: "source-indiana", canonical_url: "https://example.gov/document", title: "Official record", published_at: "2026-07-18" });
insertEvidence(database, { id: "evidence", document_id: "doc", ordinal: 1, quote: "The official record documents the action.", canonicalUrl: "https://example.gov/document", page_number: 2 });
insert(database, "updates", { id: "update", document_id: "doc", location_id: "indiana", title: "State update", published_at: "2026-07-18" });
assert.equal(projectEvidenceForLocation(database, "indy").length, 1);
assert.equal(projectEvidenceForLocation(database, "federal").length, 0);
assertDatabaseIntegrity(database);
database.close();
console.log("evidence contract checks passed");
