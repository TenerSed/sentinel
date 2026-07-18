import type { CuratedReason, CuratedSignal, CuratedState, EvidenceRecord, RankedCuratedRecord } from "./types";

export const CURATED_STORAGE_KEY = "lamplighter-curated-v1";
const VERSION = 1 as const;
const MAX_TOPICS = 12;
const MAX_SIGNALS = 60;
const topicPattern = /^[a-z][a-z0-9-]{0,39}$/;

export function normalizeTopic(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return topicPattern.test(normalized) ? normalized : undefined;
}

export function emptyCuratedState(): CuratedState {
  return { version: VERSION, signals: [], topics: [] };
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function normalizedTopics(value: unknown, maximum = MAX_TOPICS) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) return undefined;
  const topics = value.map(normalizeTopic);
  return topics.every((topic): topic is string => Boolean(topic)) && new Set(topics).size === topics.length ? topics : undefined;
}

function validSignal(value: unknown, knownRecordIds: ReadonlySet<string>): CuratedSignal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const signal = value as Record<string, unknown>;
  if (!validTimestamp(signal.at)) return undefined;
  const at = signal.at as string;
  if (signal.kind === "chat" && Object.keys(signal).length === 3) {
    const topics = normalizedTopics(signal.topics, 8);
    return topics ? { kind: "chat", topics, at } : undefined;
  }
  if ((signal.kind === "citation" || signal.kind === "recent") && Object.keys(signal).length === 3 && typeof signal.recordId === "string" && knownRecordIds.has(signal.recordId)) {
    return { kind: signal.kind, recordId: signal.recordId, at };
  }
  return undefined;
}

export function parseCuratedState(value: unknown, knownRecordIds: ReadonlySet<string>): CuratedState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyCuratedState();
  const state = value as Record<string, unknown>;
  if (Object.keys(state).length !== 3 || state.version !== VERSION || !Array.isArray(state.signals) || state.signals.length > MAX_SIGNALS) return emptyCuratedState();
  const storedTopics = state.topics as unknown[];
  const topics = storedTopics.length ? normalizedTopics(storedTopics) : [];
  if (!topics) return emptyCuratedState();
  const signals = state.signals.map((signal) => validSignal(signal, knownRecordIds));
  if (signals.some((signal) => !signal)) return emptyCuratedState();
  return { version: VERSION, topics, signals: signals as CuratedSignal[] };
}

export function topicsFromQuestion(question: string, knownTopics: readonly string[]) {
  if (typeof question !== "string") return [];
  const input = question.toLowerCase();
  return [...new Set(knownTopics.map(normalizeTopic).filter((topic): topic is string => Boolean(topic)).filter((topic) => {
    const words = topic.split("-").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`\\b${words.join("[-\\s]+")}\\b`, "i").test(input);
  }))];
}

export function recordSignal(state: CuratedState, signal: CuratedSignal, knownRecordIds: ReadonlySet<string>) {
  const current = parseCuratedState(state, knownRecordIds);
  const safe = validSignal(signal, knownRecordIds);
  if (!safe) return current;
  const key = safe.kind === "chat" ? `${safe.kind}:${safe.topics.join(",")}` : `${safe.kind}:${safe.recordId}`;
  const signals = [...current.signals.filter((item) => (item.kind === "chat" ? `${item.kind}:${item.topics.join(",")}` : `${item.kind}:${item.recordId}`) !== key), safe].slice(-MAX_SIGNALS);
  return { ...current, signals };
}

export function resetCuratedState() {
  return emptyCuratedState();
}

function dot(left: readonly number[], right: readonly number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function actionFor(record: EvidenceRecord, state: CuratedState, byId: Map<string, EvidenceRecord>) {
  const matchesTopics = (topics: readonly string[]) => topics.some((topic) => record.topics.includes(topic));
  if (state.signals.some((signal) => signal.kind === "chat" && matchesTopics(signal.topics))) return "recent Chat question" as const;
  if (state.signals.some((signal) => signal.kind === "citation" && matchesTopics(byId.get(signal.recordId)?.topics ?? []))) return "copied citation" as const;
  if (state.signals.some((signal) => signal.kind === "recent" && matchesTopics(byId.get(signal.recordId)?.topics ?? []))) return "opened update" as const;
  return undefined;
}

function recency(record: EvidenceRecord, newest: string): CuratedReason["recency"] {
  if (record.publishedAt === newest) return "newest available";
  return Date.now() - Date.parse(record.publishedAt) < 1000 * 60 * 60 * 24 * 90 ? "recent public update" : "earlier public update";
}

export function rankCuratedRecords(candidates: readonly EvidenceRecord[], value: unknown): RankedCuratedRecord[] {
  const byId = new Map(candidates.map((record) => [record.id, record]));
  const state = parseCuratedState(value, new Set(byId.keys()));
  const newest = candidates[0]?.publishedAt ?? "";
  if (!state.topics.length && !state.signals.length) return candidates.map((record) => ({ record, starter: true, reason: { recency: recency(record, newest) } }));

  const topicWeights = new Map<string, number>();
  const profile = Array.from({ length: candidates[0]?.embedding.length ?? 0 }, () => 0);
  const addTopics = (topics: readonly string[], weight: number) => {
    for (const topic of topics) topicWeights.set(topic, (topicWeights.get(topic) ?? 0) + weight);
    for (const record of candidates) if (topics.some((topic) => record.topics.includes(topic))) for (let index = 0; index < profile.length; index += 1) profile[index] += record.embedding[index] * weight;
  };
  addTopics(state.topics, 1);
  for (const signal of state.signals) {
    if (signal.kind === "chat") addTopics(signal.topics, 3);
    else addTopics(byId.get(signal.recordId)?.topics ?? [], signal.kind === "citation" ? 2 : 1);
  }
  const profileNorm = Math.hypot(...profile);
  const rank = candidates.map((record) => {
    const topicScore = record.topics.reduce((total, topic) => total + (topicWeights.get(topic) ?? 0), 0);
    const cosine = profileNorm ? dot(record.embedding, profile) / profileNorm : 0;
    const score = topicScore + cosine * 0.25 + Date.parse(record.publishedAt) / 1e18;
    const action = actionFor(record, state, byId);
    const topic = record.topics.find((item) => (topicWeights.get(item) ?? 0) > 0);
    return { record, score, starter: false, reason: { ...(topic ? { topic } : {}), ...(action ? { action } : {}), recency: recency(record, newest) } };
  });
  // ponytail: O(records × signals) is intentional for the tiny bundled corpus; add indexed/server retrieval only when the corpus grows.
  return rank.sort((left, right) => right.score - left.score || right.record.publishedAt.localeCompare(left.record.publishedAt) || left.record.id.localeCompare(right.record.id)).map(({ score: _score, ...item }) => item);
}
