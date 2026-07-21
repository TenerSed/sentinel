// Idempotently canonicalize/merge Case nodes and rebuild deterministic case caches.
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { graphDriver } from "./lib/neo4j.mjs";
import {
  canonicalCaseId,
  cleanCaseId,
  extractCompoundCaseIds,
  isCompoundCaseId,
} from "../../server/case-id.mjs";

const nonEmpty = (value) => value != null && String(value).trim().length > 0;
const score = (node) => [node.request, node.title, node.status, node.decision_source_id, node.source_id].filter(nonEmpty).length;
const asArray = (value) => (Array.isArray(value) ? value.flatMap(asArray) : value == null ? [] : [value]);
const validDate = (value) => value && Number.isFinite(Date.parse(value));
const iso = (value) => validDate(value) ? new Date(value).toISOString() : null;
const humanDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const db = new Database(path.join(root, "data", "fishers.db"));
const driver = graphDriver();
const session = driver.session();

function mergeObjects(base, incoming) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return incoming ?? base;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return nonEmpty(incoming) ? incoming : base;
  const output = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) output[key] = [...new Map([...(Array.isArray(output[key]) ? output[key] : []), ...value].map((item) => [JSON.stringify(item), item])).values()];
    else if (value && typeof value === "object") output[key] = mergeObjects(output[key] || {}, value);
    else if (!nonEmpty(output[key]) && nonEmpty(value)) output[key] = value;
  }
  return output;
}

function sourceEvent(sourceId) {
  const id = Number(sourceId);
  if (!Number.isInteger(id)) return null;
  return db.prepare(`SELECT coalesce(e.start_datetime,e.event_date) AS event_date
    FROM cc_files f JOIN cc_events e ON e.event_id=f.event_id WHERE f.file_id=?`).get(id)?.event_date || null;
}

function resolveAction(row) {
  const decisionDates = asArray(row.decision_source_id).map(sourceEvent).filter(validDate);
  if (decisionDates.length) {
    const date = decisionDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    return { last_action_date: iso(date), last_action_label: `Board vote · ${humanDate(date)}` };
  }
  const meetingDates = asArray(row.meeting_dates).filter(validDate);
  if (meetingDates.length) {
    const date = meetingDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    return { last_action_date: iso(date), last_action_label: `Discussed · ${humanDate(date)}` };
  }
  const filedDates = asArray(row.source_id).map(sourceEvent).filter(validDate);
  if (filedDates.length) {
    const date = filedDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    return { last_action_date: iso(date), last_action_label: `Filed · ${humanDate(date)}` };
  }
  const documentDates = asArray(row.document_sources).map(sourceEvent).filter(validDate);
  if (documentDates.length) {
    const date = documentDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    return { last_action_date: iso(date), last_action_label: `Discussed · ${humanDate(date)}` };
  }
  return { last_action_date: null, last_action_label: null };
}

try {
  const rows = (await session.run("MATCH (c:Case) WHERE c.case_number IS NOT NULL RETURN elementId(c) AS id,properties(c) AS properties,c.case_number AS case_number,c.request AS request,c.title AS title,c.status AS status,c.source_id AS source_id,c.decision_source_id AS decision_source_id")).records.map((record) => record.toObject());
  const known = rows.map((row) => row.case_number);
  const compounds = rows.filter((row) => isCompoundCaseId(row.case_number));
  let droppedCompounds = 0;
  for (const compound of compounds) {
    const targets = extractCompoundCaseIds(compound.case_number).map((value) => canonicalCaseId(value, known));
    if (targets.length > 1 && targets.every((target) => rows.some((row) => canonicalCaseId(row.case_number, known) === target && row.id !== compound.id))) {
      await session.run("MATCH (c:Case) WHERE elementId(c)=$id DETACH DELETE c", { id: compound.id });
      droppedCompounds++;
    }
  }
  const groups = new Map();
  for (const node of rows.filter((row) => !compounds.some((compound) => compound.id === row.id))) {
    const key = canonicalCaseId(node.case_number, known);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  let mergedGroups = 0, mergedNodes = 0, renamedNodes = 0;
  for (const [canonical, nodes] of groups) {
    const ordered = [...nodes].sort((a, b) => Number(cleanCaseId(b.case_number) === canonical) - Number(cleanCaseId(a.case_number) === canonical) || score(b) - score(a));
    const preferred = ordered[0];
    const properties = ordered.slice().reverse().reduce((all, node) => mergeObjects(all, node.properties), { case_number: canonical });
    properties.case_number = canonical;
    if (nodes.length === 1) {
      if (cleanCaseId(preferred.case_number) !== canonical) {
        await session.run("MATCH (c:Case) WHERE elementId(c)=$id SET c.case_number=$canonical", { id: preferred.id, canonical });
        renamedNodes++;
      }
      continue;
    }
    await session.run(`MATCH (target:Case) WHERE elementId(target)=$targetId
      MATCH (c:Case) WHERE elementId(c) IN $ids
      WITH target, collect(c) AS nodes
      CALL apoc.refactor.mergeNodes(nodes, {properties:'discard', mergeRels:true, produceSelfRel:false}) YIELD node
      SET node += $properties
      RETURN elementId(node) AS id`, { targetId: preferred.id, ids: ordered.map((node) => node.id), properties });
    mergedGroups++; mergedNodes += nodes.length - 1;
  }

  const graphRows = (await session.run(`MATCH (c:Case) WHERE c.case_number IS NOT NULL
    OPTIONAL MATCH (c)-[:HEARD_AT]->(m:Meeting)
    OPTIONAL MATCH (c)-[:EVIDENCED_BY|HAS_DOCUMENT]->(doc:Document)
    RETURN c.case_number AS case_number,c.source_id AS source_id,c.decision_source_id AS decision_source_id,
      collect(DISTINCT m.date) AS meeting_dates,collect(DISTINCT doc.source_id) AS document_sources`)).records.map((record) => record.toObject());
  const currentKnown = graphRows.map((row) => row.case_number);
  const graphByCase = new Map(graphRows.map((row) => [canonicalCaseId(row.case_number, currentKnown), row]));
  const cacheRows = db.prepare("SELECT key,payload FROM app_cache WHERE key LIKE 'case:%'").all();
  const cacheKnown = cacheRows.flatMap((row) => { try { return [JSON.parse(row.payload).case_number]; } catch { return []; } });
  const payloadGroups = new Map();
  for (const cacheRow of cacheRows) {
    let payload;
    try { payload = JSON.parse(cacheRow.payload); } catch { continue; }
    if (isCompoundCaseId(payload.case_number)) continue;
    const canonical = canonicalCaseId(payload.case_number, [...currentKnown, ...cacheKnown]);
    payload.case_number = canonical;
    if (payload.facts) payload.facts.case_number = canonical;
    const current = payloadGroups.get(canonical);
    payloadGroups.set(canonical, current ? mergeObjects(current, payload) : payload);
  }
  const builtAt = new Date().toISOString();
  const insert = db.prepare("INSERT INTO app_cache(key,payload,built_at) VALUES(?,?,?)");
  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM app_cache WHERE key LIKE 'case:%'").run();
    for (const [canonical, payload] of payloadGroups) {
      const action = resolveAction(graphByCase.get(canonical) || {});
      Object.assign(payload, action);
      if (payload.facts) Object.assign(payload.facts, action);
      if (payload.meeting && action.last_action_date && !validDate(payload.meeting.date)) payload.meeting.date = action.last_action_date;
      insert.run(`case:${canonical}`, JSON.stringify(payload), builtAt);
    }
  });
  rebuild();
  const datedCases = [...payloadGroups.keys()].filter((canonical) => resolveAction(graphByCase.get(canonical) || {}).last_action_date).length;
  console.log(JSON.stringify({ before_case_nodes: rows.length, after_case_nodes: rows.length - mergedNodes - droppedCompounds, merged_groups: mergedGroups, merged_nodes: mergedNodes, renamed_nodes: renamedNodes, dropped_compounds: droppedCompounds, cached_cases: payloadGroups.size, dated_cached_cases: datedCases }, null, 2));
} finally {
  db.close();
  await session.close();
  await driver.close();
}
