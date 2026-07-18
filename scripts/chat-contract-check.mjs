import assert from "node:assert/strict";
import {
  answerQuestion,
  buildPacket,
  isCandidatePositionRequest,
  validateGroundedAnswer,
} from "../server/chat.mjs";

const insufficient = { status: "insufficient", blocks: [] };
const indy = buildPacket("indy");
const indiana = buildPacket("indiana");
const federal = buildPacket("federal");
const valid = (packet = indy) => ({ status: "answered", blocks: [{ text: "The selected record supports this answer.", evidenceIds: [packet.records[0].id] }] });
const expectInsufficient = (value, label) => assert.deepEqual(value, insufficient, label);
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("valid one-sentence answer retains issued IDs", () => {
  assert.deepEqual(validateGroundedAnswer(valid(), indy), valid());
});

test("malformed object refuses", () => expectInsufficient(validateGroundedAnswer({ status: "answered" }, indy), "malformed"));

test("answered without blocks refuses", () => expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [] }, indy), "no blocks"));

test("empty or multi-sentence text refuses", () => {
  expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [{ text: "", evidenceIds: [indy.records[0].id] }] }, indy), "empty text");
  expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [{ text: "One sentence. Another sentence.", evidenceIds: [indy.records[0].id] }] }, indy), "multiple sentences");
});

test("empty and unknown evidence IDs refuse", () => {
  expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [{ text: "Supported sentence.", evidenceIds: [] }] }, indy), "empty IDs");
  expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [{ text: "Supported sentence.", evidenceIds: ["forged"] }] }, indy), "unknown ID");
});

test("cross-coverage IDs refuse", () => {
  const foreign = federal.records.find((record) => !indy.records.some(({ id }) => id === record.id));
  assert.ok(foreign, "federal has an ID outside the Indianapolis packet");
  expectInsufficient(validateGroundedAnswer({ status: "answered", blocks: [{ text: "Supported sentence.", evidenceIds: [foreign.id] }] }, indy), "cross coverage");
});

test("Indianapolis includes only configured coverage", () => {
  assert.ok(indy.records.every((record) => ["indy", "indiana", "federal"].includes(record.locationId)));
  assert.equal(indy.records.length, 6);
});

test("Indiana and federal packets remain exact", () => {
  assert.ok(indiana.records.every((record) => record.locationId === "indiana"));
  assert.ok(federal.records.every((record) => record.locationId === "federal"));
});

test("packets are newest-first with stable IDs", () => {
  for (const packet of [indy, indiana, federal]) {
    assert.deepEqual(packet.records, [...packet.records].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)));
  }
});

test("unsupported provider result refuses", async () => {
  const result = await answerQuestion({ coverageId: "indy", question: "What is the weather?" }, { packet: indy, adapters: [async () => ({ kind: "success", provider: "OpenAI", answer: { status: "insufficient", blocks: [] } })] });
  expectInsufficient(result.answer, "provider insufficiency");
});

test("candidate-position wording without tagged packet refuses before adapters", async () => {
  let called = false;
  const result = await answerQuestion({ coverageId: "indy", question: "What is the mayor's position on housing?" }, { packet: indy, adapters: [async () => { called = true; return { kind: "success", provider: "OpenAI", answer: valid() }; }] });
  expectInsufficient(result.answer, "position preflight");
  assert.equal(called, false);
  assert.equal(isCandidatePositionRequest("What is the mayor's position on housing?"), true);
});

test("tagged direct-position packet permits adapter", async () => {
  const packet = { ...indy, records: [{ ...indy.records[0], evidenceKind: "recent_public_position", sourceKind: "government_record" }] };
  let called = false;
  const result = await answerQuestion({ coverageId: "indy", question: "What is the mayor's position on housing?" }, { packet, adapters: [async () => { called = true; return { kind: "success", provider: "OpenAI", answer: valid(packet) }; }] });
  assert.equal(called, true);
  assert.equal(result.answer.status, "answered");
});

test("untagged reporting vote party and affiliation cannot satisfy position preflight", async () => {
  for (const sourceKind of ["reporting", "government_record"]) {
    const packet = { ...indy, records: [{ ...indy.records[0], evidenceKind: "civic_update", sourceKind }] };
    let called = false;
    const result = await answerQuestion({ coverageId: "indy", question: "What is the candidate's view on policy?" }, { packet, adapters: [async () => { called = true; return { kind: "success", provider: "OpenAI", answer: valid(packet) }; }] });
    expectInsufficient(result.answer, sourceKind);
    assert.equal(called, false);
  }
});

test("materially differing claims remain separate blocks", () => {
  const result = validateGroundedAnswer({ status: "answered", blocks: [
    { text: "One record states the proposal applies.", evidenceIds: [indy.records[0].id] },
    { text: "Another record states the proposal does not apply.", evidenceIds: [indy.records[1].id] },
  ] }, indy);
  assert.equal(result.status, "answered");
  assert.equal(result.blocks.length, 2);
});

test("OpenAI timeout reaches Anthropic", async () => {
  const calls = [];
  const result = await answerQuestion({ coverageId: "indy", question: "Tell me about this." }, { packet: indy, adapters: [
    async () => { calls.push("OpenAI"); return { kind: "transient_failure", provider: "OpenAI", errorType: "timeout" }; },
    async () => { calls.push("Anthropic"); return { kind: "success", provider: "Anthropic", answer: valid() }; },
  ] });
  assert.deepEqual(calls, ["OpenAI", "Anthropic"]);
  assert.equal(result.provider, "Anthropic");
});

test("absent provider is skipped", async () => {
  const calls = [];
  const result = await answerQuestion({ coverageId: "indy", question: "Tell me about this." }, { packet: indy, adapters: [
    async () => ({ kind: "skipped", provider: "OpenAI" }),
    async () => { calls.push("Gemini"); return { kind: "success", provider: "Gemini", answer: valid() }; },
  ] });
  assert.deepEqual(calls, ["Gemini"]);
  assert.equal(result.provider, "Gemini");
});

test("invalid or insufficient output stops fallback", async () => {
  for (const answer of [{ bad: true }, { status: "insufficient", blocks: [] }, { status: "answered", blocks: [{ text: "Supported sentence.", evidenceIds: ["forged"] }] }]) {
    let nextCalled = false;
    const result = await answerQuestion({ coverageId: "indy", question: "Tell me about this." }, { packet: indy, adapters: [
      async () => ({ kind: "success", provider: "OpenAI", answer }),
      async () => { nextCalled = true; return { kind: "success", provider: "Anthropic", answer: valid() }; },
    ] });
    expectInsufficient(result.answer, "invalid primary output");
    assert.equal(nextCalled, false);
  }
});

test("non-transient 4xx stops fallback", async () => {
  let nextCalled = false;
  const result = await answerQuestion({ coverageId: "indy", question: "Tell me about this." }, { packet: indy, adapters: [
    async () => ({ kind: "terminal_failure", provider: "OpenAI", errorType: "http_401" }),
    async () => { nextCalled = true; return { kind: "success", provider: "Anthropic", answer: valid() }; },
  ] });
  expectInsufficient(result.answer, "terminal 4xx");
  assert.equal(nextCalled, false);
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`passed: ${name}`);
}
console.log(`chat contract checks passed: ${cases.length} cases`);
