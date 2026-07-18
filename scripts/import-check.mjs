import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCanonicalUrl, validateEvidence } from "./evidence-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowlist = JSON.parse(fs.readFileSync(path.join(root, "data/import-sources.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "data/seed-records.json"), "utf8"));
const locations = new Set(fixture.locations.map(({ id }) => id));
const memberships = new Set(fixture.sourceLocations.map(({ sourceId, locationId }) => `${sourceId}:${locationId}`));

function validateSource(source) {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname) || !locations.has(source.locationId) || !memberships.has(`${source.id}:${source.locationId}`)) {
    throw new Error(`invalid allowlisted source: ${source.id}`);
  }
  return normalizeCanonicalUrl(source.url);
}

function hash(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function importCandidate(store, source, candidate) {
  const canonicalUrl = normalizeCanonicalUrl(candidate.url);
  if (new URL(canonicalUrl).hostname !== new URL(source.url).hostname || !source.allowedHosts.includes(new URL(canonicalUrl).hostname)) {
    throw new Error("canonical URL is outside the source allowlist");
  }
  if (store.urls.has(canonicalUrl)) return "duplicate-url";
  const contentHash = hash(candidate.body);
  if (store.hashes.has(contentHash)) return "duplicate-content";
  try {
    validateEvidence({ quote: candidate.quote, canonicalUrl, pageNumber: candidate.pageNumber, startSeconds: candidate.startSeconds });
    store.urls.add(canonicalUrl);
    store.hashes.add(contentHash);
    return "eligible";
  } catch {
    store.drafts.push(canonicalUrl);
    return "draft";
  }
}

assert.equal(allowlist.version, 1);
for (const source of allowlist.sources) assert.doesNotThrow(() => validateSource(source));
assert.throws(() => validateSource({ ...allowlist.sources[0], url: "http://www.indy.gov/" }));
assert.throws(() => validateSource({ ...allowlist.sources[0], url: "https://example.com/" }));
assert.throws(() => validateSource({ ...allowlist.sources[0], locationId: "federal" }));

const source = allowlist.sources[0];
const store = { urls: new Set(), hashes: new Set(), drafts: [] };
const cited = { url: "https://www.indy.gov/records/item#section", body: "same source bytes", quote: "A public record supports this update.", pageNumber: 1 };
assert.equal(importCandidate(store, source, cited), "eligible");
assert.equal(importCandidate(store, source, { ...cited, url: "https://www.indy.gov/records/item" }), "duplicate-url");
assert.equal(importCandidate(store, source, { ...cited, url: "https://www.indy.gov/records/another" }), "duplicate-content");
assert.equal(importCandidate(store, source, { url: "https://www.indy.gov/records/draft", body: "uncited bytes" }), "draft");
assert.deepEqual(store.drafts, ["https://www.indy.gov/records/draft"]);
console.log("import boundary checks passed");
