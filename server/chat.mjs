import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectEvidenceForLocation } from "../scripts/evidence-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = path.join(root, "data/lamplighter.db");
const timeoutMs = 12_000;
const insufficient = Object.freeze({ status: "insufficient", blocks: [] });

export const answerSchema = {
  type: "object", additionalProperties: false, required: ["status", "blocks"],
  properties: {
    status: { type: "string", enum: ["answered", "insufficient"] },
    blocks: { type: "array", maxItems: 4, items: {
      type: "object", additionalProperties: false, required: ["text", "evidenceIds"],
      properties: { text: { type: "string", maxLength: 500 }, evidenceIds: { type: "array", minItems: 1, items: { type: "string" } } },
    } },
  },
};

export function buildPacket(coverageId, filename = databasePath) {
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const coverage = database.prepare("SELECT id, label FROM locations WHERE id = ?").get(coverageId);
    if (!coverage) return null;
    return { coverageId, coverageLabel: coverage.label, records: projectEvidenceForLocation(database, coverageId).slice(0, 6) };
  } finally {
    database.close();
  }
}

export function isCandidatePositionRequest(question) {
  return /\b(candidate|office[- ]holder|mayor|governor|council(?:member)?|senator|representative)\b/i.test(question)
    && /\b(position|stance|view|views|stand|policy position|believe)\b/i.test(question);
}

function oneSentence(text) {
  const value = text.trim();
  return value.length > 0 && value.length <= 500 && !/[\n\r]/.test(value)
    && !/[.!?][”"')\]]?\s+[A-Z0-9]/.test(value);
}

export function validateGroundedAnswer(value, packet) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !("status" in value) || !("blocks" in value)) return insufficient;
  if (value.status === "insufficient") return Array.isArray(value.blocks) && value.blocks.length === 0 ? insufficient : insufficient;
  if (value.status !== "answered" || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 4) return insufficient;
  const allowed = new Set(packet.records.map(({ id }) => id));
  const blocks = [];
  for (const block of value.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block) || Object.keys(block).length !== 2 || typeof block.text !== "string" || !Array.isArray(block.evidenceIds) || !oneSentence(block.text)) return insufficient;
    const evidenceIds = [...new Set(block.evidenceIds)];
    if (!evidenceIds.length || !evidenceIds.every((id) => typeof id === "string" && allowed.has(id))) return insufficient;
    blocks.push({ text: block.text.trim(), evidenceIds });
  }
  return { status: "answered", blocks };
}

function packetPrompt(question, packet) {
  return JSON.stringify({ question, packet: packet.records.map(({ id, title, publishedAt, updateType, sourceKind, publisher, locator, exactQuote, evidenceKind }) => ({ id, title, publishedAt, updateType, sourceKind, publisher, locator, exactQuote, evidenceKind })) });
}

const systemPrompt = "Answer only from PACKET. Each factual sentence or bullet is one cited AnswerBlock. Candidate or office-holder positions require a recent_public_position PACKET record; never infer from votes, party, or affiliation. Show differing supported claims separately and never choose a winner. Return insufficient when PACKET cannot answer.";
const transientStatus = (status) => status === 408 || status === 429 || status >= 500;
const classifiedFetch = async (provider, url, init) => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { kind: transientStatus(response.status) ? "transient_failure" : "terminal_failure", provider, errorType: `http_${response.status}` };
    return { kind: "success", provider, body: await response.json() };
  } catch (error) {
    return { kind: "transient_failure", provider, errorType: error?.name === "TimeoutError" ? "timeout" : "network" };
  }
};

export async function answerWithOpenAI(question, packet, key) {
  if (!key) return { kind: "skipped", provider: "OpenAI" };
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: timeoutMs });
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-5.6", input: [{ role: "system", content: systemPrompt }, { role: "user", content: packetPrompt(question, packet) }], max_output_tokens: 450, text: { format: { type: "json_schema", name: "grounded_answer", strict: true, schema: answerSchema } } });
    return { kind: "success", provider: "OpenAI", answer: JSON.parse(response.output_text) };
  } catch (error) {
    const status = error?.status;
    return { kind: transientStatus(status) || error?.name === "APIConnectionTimeoutError" || error?.name === "APIConnectionError" ? "transient_failure" : "terminal_failure", provider: "OpenAI", errorType: status ? `http_${status}` : "network" };
  }
}

export async function answerWithAnthropic(question, packet, key) {
  if (!key) return { kind: "skipped", provider: "Anthropic" };
  const result = await classifiedFetch("Anthropic", "https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: 450, system: systemPrompt, messages: [{ role: "user", content: packetPrompt(question, packet) }], output_config: { format: { type: "json_schema", schema: answerSchema } } }) });
  if (result.kind !== "success") return result;
  try { return { kind: "success", provider: "Anthropic", answer: JSON.parse(result.body.content?.[0]?.text) }; } catch { return { kind: "terminal_failure", provider: "Anthropic", errorType: "malformed_output" }; }
}

export async function answerWithGemini(question, packet, key) {
  if (!key) return { kind: "skipped", provider: "Gemini" };
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const result = await classifiedFetch("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: packetPrompt(question, packet) }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: answerSchema, maxOutputTokens: 450 } }) });
  if (result.kind !== "success") return result;
  try { return { kind: "success", provider: "Gemini", answer: JSON.parse(result.body.candidates?.[0]?.content?.parts?.[0]?.text) }; } catch { return { kind: "terminal_failure", provider: "Gemini", errorType: "malformed_output" }; }
}

export function liveStatus(keys = process.env) {
  const providers = [["OpenAI", keys.OPENAI_API_KEY], ["Anthropic", keys.ANTHROPIC_API_KEY], ["Gemini", keys.GEMINI_API_KEY]].filter(([, key]) => Boolean(key)).map(([name]) => name);
  return { available: providers.length > 0, providers };
}

export async function answerQuestion({ coverageId, question }, options = {}) {
  if (!coverageId || typeof coverageId !== "string" || typeof question !== "string" || !question.trim()) return { answer: insufficient, error: "invalid_request" };
  const packet = options.packet || buildPacket(coverageId, options.databasePath);
  if (!packet) return { answer: insufficient, error: "invalid_coverage" };
  if (isCandidatePositionRequest(question) && !packet.records.some((record) => record.evidenceKind === "recent_public_position")) return { answer: insufficient, packet };
  const keys = options.keys || process.env;
  const adapters = options.adapters || [
    () => answerWithOpenAI(question, packet, keys.OPENAI_API_KEY),
    () => answerWithAnthropic(question, packet, keys.ANTHROPIC_API_KEY),
    () => answerWithGemini(question, packet, keys.GEMINI_API_KEY),
  ];
  let lastFailure;
  for (const call of adapters) {
    const result = await call();
    if (result.kind === "skipped") continue;
    if (result.kind === "success") {
      const answer = validateGroundedAnswer(result.answer, packet);
      return { answer, packet, provider: answer.status === "answered" ? result.provider : undefined };
    }
    lastFailure = result;
    if (result.kind !== "transient_failure") return { answer: insufficient, packet, error: { provider: result.provider, type: result.errorType } };
  }
  return { answer: insufficient, packet, ...(lastFailure ? { error: { provider: lastFailure.provider, type: lastFailure.errorType } } : {}) };
}
