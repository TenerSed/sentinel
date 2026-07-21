const CASE_PREFIXES = "RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC";
const PREFIX = new RegExp(`^(${CASE_PREFIXES})`, "i");
const FULL = new RegExp(`^(${CASE_PREFIXES})[\\s._-]*(\\d{2})[\\s._-]+(\\d+)`, "i");
const COMPACT = new RegExp(`^(${CASE_PREFIXES})(\\d{2})(\\d+)$`, "i");
const SHORT = new RegExp(`^(${CASE_PREFIXES})[\\s._-]*(\\d{1,2})$`, "i");
const TOKEN = new RegExp(`\\b(?:${CASE_PREFIXES})[\\s._-]*\\d{1,4}(?:[\\s._-]+\\d+)?\\b`, "gi");

export const cleanCaseId = (value) => String(value || "").trim().toUpperCase();
export const caseIdentity = (value) => cleanCaseId(value).replace(/[^A-Z0-9]/g, "");
export const isCompoundCaseId = (value) =>
  /\bAND\s*\/\s*OR\b|\bAND\b|&|\//i.test(cleanCaseId(value)) &&
  extractCompoundCaseIds(value).length > 1;

export function extractCompoundCaseIds(value) {
  return [...cleanCaseId(value).matchAll(TOKEN)].map((match) => match[0]);
}

export function canonicalCaseId(value, knownValues = []) {
  const raw = cleanCaseId(value);
  if (!PREFIX.test(raw)) return raw;
  const full = raw.match(FULL);
  if (full) return `${full[1].toUpperCase()}-${full[2]}-${Number(full[3])}`;
  const compact = raw.replace(/[^A-Z0-9]/g, "").match(COMPACT);
  if (compact)
    return `${compact[1].toUpperCase()}-${compact[2]}-${Number(compact[3])}`;
  const short = raw.match(SHORT);
  if (!short) return raw;
  const prefix = short[1].toUpperCase();
  const sequence = Number(short[2]);
  const candidates = new Set(
    knownValues
      .map(cleanCaseId)
      .map((candidate) => candidate.match(FULL))
      .filter(Boolean)
      .filter((match) => match[1].toUpperCase() === prefix && Number(match[3]) === sequence)
      .map((match) => `${prefix}-${match[2]}-${Number(match[3])}`),
  );
  return candidates.size === 1 ? [...candidates][0] : raw;
}
