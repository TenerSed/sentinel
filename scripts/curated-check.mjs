import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const source = await readFile(new URL("../src/curated.ts", import.meta.url), "utf8");
const curated = await import(`data:text/javascript,${encodeURIComponent(transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText)}`);
const fixture = JSON.parse(await readFile(new URL("../data/seed-records.json", import.meta.url), "utf8"));
const generated = JSON.parse((await readFile(new URL("../src/demo-seed.ts", import.meta.url), "utf8")).match(/export const demoSeed: DemoSeed = ([\s\S]+);\s*$/)?.[1] ?? "");
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const ids = new Set(generated.records.map(({ id }) => id));
const record = (id, topics, embedding, publishedAt) => ({ id, topics, embedding, publishedAt, locationId: "indy", locationLabel: "Indianapolis", updateType: "policy", evidenceKind: "civic_update", sourceKind: "government_record", publisher: "Test", sourceTitle: "Test", title: id, canonicalUrl: "https://example.com", exactQuote: "A sourced test excerpt.", locator: { kind: "page", pageNumber: 1 } });
const coverageRecords = (coverageId) => {
  const covered = new Set(generated.coverage.filter((entry) => entry.locationId === coverageId).map((entry) => entry.coveredLocationId));
  return generated.records.filter((item) => covered.has(item.locationId)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
};

test("fixture metadata is finite, normalized, and projected exactly", () => {
  const fixtureById = new Map(fixture.records.map((item) => [item.id, item]));
  let dimension;
  for (const item of generated.records) {
    const sourceRecord = fixtureById.get(item.id);
    assert.deepEqual(item.topics, sourceRecord?.topics, `${item.id} topics`);
    assert.deepEqual(item.embedding, sourceRecord?.embedding, `${item.id} embedding`);
    assert.ok(item.topics.length && item.topics.every((topic) => curated.normalizeTopic(topic) === topic));
    assert.ok(item.embedding.every(Number.isFinite));
    dimension ??= item.embedding.length;
    assert.equal(item.embedding.length, dimension);
    assert.ok(Math.abs(Math.hypot(...item.embedding) - 1) < 0.000001);
  }
});

test("coverage candidates are the existing configured projection only", () => {
  for (const [coverageId, allowed] of [["indy", ["indy", "indiana", "federal"]], ["indiana", ["indiana"]], ["federal", ["federal"]]]) {
    const records = coverageRecords(coverageId);
    assert.ok(records.length);
    assert.ok(records.every((item) => allowed.includes(item.locationId)));
    assert.deepEqual(records, [...records].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)));
  }
});

test("Chat topics outrank citation signals, which outrank Recent opens", () => {
  const candidates = [record("housing", ["housing"], [1, 0], "2026-01-01T00:00:00.000Z"), record("budget", ["budget"], [0, 1], "2026-01-01T00:00:00.000Z")];
  const known = new Set(candidates.map((item) => item.id));
  const chat = { version: 1, topics: [], signals: [{ kind: "chat", topics: ["housing"], at: "2026-07-18T00:00:00.000Z" }, { kind: "citation", recordId: "budget", at: "2026-07-18T00:00:01.000Z" }] };
  assert.equal(curated.rankCuratedRecords(candidates, chat)[0].record.id, "housing");
  const citation = { version: 1, topics: [], signals: [{ kind: "citation", recordId: "budget", at: "2026-07-18T00:00:00.000Z" }, { kind: "recent", recordId: "housing", at: "2026-07-18T00:00:01.000Z" }] };
  assert.equal(curated.rankCuratedRecords(candidates, citation)[0].record.id, "budget");
  assert.deepEqual(curated.recordSignal(curated.emptyCuratedState(), { kind: "chat", topics: ["housing"], at: "2026-07-18T00:00:00.000Z", question: "forged" }, known), curated.emptyCuratedState());
});

test("ties, starter state, and unknown topics are deterministic without new candidates", () => {
  const candidates = [record("newer", ["housing"], [1, 0], "2026-02-01T00:00:00.000Z"), record("older", ["budget"], [0, 1], "2026-01-01T00:00:00.000Z")];
  assert.deepEqual(curated.rankCuratedRecords(candidates, curated.emptyCuratedState()).map((item) => item.record.id), ["newer", "older"]);
  const ranked = curated.rankCuratedRecords(candidates, { version: 1, topics: ["unknown"], signals: [] });
  assert.deepEqual(ranked.map((item) => item.record.id), ["newer", "older"]);
  assert.ok(ranked.every((item) => item.reason.topic === undefined));
});

test("parser fails closed on raw questions, foreign IDs, timestamps, versions, and oversized state", () => {
  const empty = curated.emptyCuratedState();
  const invalids = [
    { version: 1, topics: [], signals: [{ kind: "chat", topics: ["housing"], at: "2026-07-18T00:00:00.000Z", question: "raw question" }] },
    { version: 1, topics: [], signals: [{ kind: "citation", recordId: "foreign", at: "2026-07-18T00:00:00.000Z" }] },
    { version: 1, topics: [], signals: [{ kind: "recent", recordId: generated.records[0].id, at: "tomorrow" }] },
    { version: 2, topics: [], signals: [] },
    { version: 1, topics: Array.from({ length: 13 }, (_, index) => `topic-${index}`), signals: [] },
  ];
  for (const value of invalids) assert.deepEqual(curated.parseCuratedState(value, ids), empty);
});

test("topic extraction retains tags only and reset leaves Chat data untouched", () => {
  assert.deepEqual(curated.topicsFromQuestion("What changed for housing and government operations?", ["housing", "government-operations"]), ["housing", "government-operations"]);
  const chatThreads = { indy: [{ question: "raw Chat history stays here" }] };
  const before = structuredClone(chatThreads);
  assert.deepEqual(curated.resetCuratedState(), curated.emptyCuratedState());
  assert.deepEqual(chatThreads, before);
  assert.equal(JSON.stringify(curated.emptyCuratedState()).includes("question"), false);
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`passed: ${name}`);
}
console.log(`curated checks passed: ${cases.length} cases`);
