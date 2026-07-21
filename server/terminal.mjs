import neo4j from "neo4j-driver";
import { narrate, predict } from "./insights.mjs";

const asNumber = (value) => typeof value?.toNumber === "function" ? value.toNumber() : Number(value || 0);
const plain = (record) => Object.fromEntries(Object.entries(record.toObject()).map(([key, value]) => [key, Array.isArray(value) ? value.map((item) => typeof item?.toNumber === "function" ? item.toNumber() : item) : typeof value?.toNumber === "function" ? value.toNumber() : value]));
const nodeLabel = (node) => (node.labels || []).find((label) => label !== "OpenEntity") || node.labels?.[0] || "Entity";
const nodeCaption = (node) => String((node.properties || {}).case_number ?? (node.properties || {}).name ?? (node.properties || {}).address ?? (node.properties || {}).code ?? (node.properties || {}).board ?? (node.properties || {}).title ?? node.elementId);
const compact = (text, terms = []) => {
  const source = String(text || "").replace(/\s+/g, " ").trim(); const lower = source.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(String(term || "").toLowerCase())).find((index) => index >= 0) ?? 0;
  return source.slice(Math.max(0, hit - 120), Math.max(0, hit - 120) + 320).trim();
};
const resultNode = (node) => ({ id: node.elementId, label: nodeLabel(node), caption: nodeCaption(node), props: node.properties || {} });
const terminalStatus = "toLower(coalesce(c.status,'')) CONTAINS 'approv' OR toLower(coalesce(c.status,'')) CONTAINS 'den' OR toLower(coalesce(c.status,'')) CONTAINS 'withdraw' OR toLower(coalesce(c.status,'')) CONTAINS 'table' OR toLower(coalesce(c.status,'')) CONTAINS 'continu'";
const landUse = "c.case_number =~ '(?i)^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?.*' OR toLower(coalesce(c.case_type,'')) =~ '.*(rezon|varianc|pud|annex|special[ -]?exception|plat).*'";
const isLandUse = (row) => /^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?\d/i.test(String(row.case_number || "")) || /(rezon|varianc|pud|annex|special[ -]?exception|plat)/i.test(String(row.case_type || ""));

export async function terminalSearch(driver, q, limit = 20) {
  if (!driver) return { results: [], error: "neo4j_unavailable" };
  const term = String(q || "").trim(); if (!term) return { results: [] };
  const session = driver.session();
  try {
    const query = `CALL {
      MATCH (n:Case) WHERE toLower(coalesce(n.case_number,'')) CONTAINS toLower($q) OR toLower(coalesce(n.title,'')) CONTAINS toLower($q)
      OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
      UNION MATCH (n:Person) WHERE toLower(coalesce(n.name,'')) CONTAINS toLower($q) OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
      UNION MATCH (n:Organization) WHERE toLower(coalesce(n.name,'')) CONTAINS toLower($q) OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
      UNION MATCH (n:Parcel) WHERE toLower(coalesce(n.address,'')) CONTAINS toLower($q) OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
      UNION MATCH (n:ZoningDistrict) WHERE toLower(coalesce(n.code,'')) CONTAINS toLower($q) OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
      UNION MATCH (n:Meeting) WHERE toLower(coalesce(n.board,'')) CONTAINS toLower($q) OPTIONAL MATCH (n)--() WITH n,count(*) AS degree RETURN n,degree
    } RETURN n,degree ORDER BY CASE WHEN n:Case THEN 0 ELSE 1 END, degree DESC LIMIT $limit`;
    const rows = (await session.run(query, { q: term, limit: neo4j.int(Math.max(1, Math.floor(asNumber(limit)))) })).records;
    return { results: rows.map((record) => { const node = record.get("n"), p = node.properties || {}, label = nodeLabel(node), degree = asNumber(record.get("degree")); return { id: node.elementId, label, caption: nodeCaption(node), sublabel: label === "Case" ? String(p.status || p.case_type || "Case") : degree ? `${degree} connection${degree === 1 ? "" : "s"}` : label }; }) };
  } finally { await session.close(); }
}

async function connections(session, id) {
  const rows = await session.run("MATCH (n)-[r]-(m) WHERE elementId(n)=$id RETURN r,m,CASE WHEN elementId(startNode(r))=$id THEN 'out' ELSE 'in' END AS direction ORDER BY coalesce(r.confidence,0) DESC LIMIT 40", { id });
  return rows.records.map((record) => { const r = record.get("r"), m = record.get("m"); return { type: r.type, direction: record.get("direction"), neighbor: { id: m.elementId, label: nodeLabel(m), caption: nodeCaption(m) }, confidence: r.properties?.confidence ?? null, source: r.properties?.source ?? null }; });
}

async function baseRate(session) {
  const row = (await session.run(`MATCH (c:Case) WHERE (${landUse}) AND (${terminalStatus}) RETURN count(c) AS decided,sum(CASE WHEN toLower(coalesce(c.status,'')) CONTAINS 'approv' THEN 1 ELSE 0 END) AS approved`)).records[0];
  const decided = asNumber(row?.get("decided")); const approved = asNumber(row?.get("approved"));
  return { decided, approved, base_rate: decided ? Math.round(100 * approved / decided) : 0 };
}

async function playerAnalytics(session, id, relation, name = null) {
  const pattern = relation === "REPRESENTS" ? "(n)-[:REPRESENTS]->() -[:APPLICANT_FOR]->(c:Case)" : "(n)-[:APPLICANT_FOR]->(c:Case)";
  const rows = await session.run(`MATCH ${pattern} WHERE elementId(n)=$id OR (n:Person AND n.name=$name) RETURN DISTINCT c.case_number AS case_number,c.status AS status,c.case_type AS case_type,c.title AS title ORDER BY case_number`, { id, name });
  const cases = rows.records.map(plain).filter(isLandUse); const decidedCases = cases.filter((row) => /approv|den|withdraw|table|continu/i.test(String(row.status || "")));
  const approved = decidedCases.filter((row) => /approv/i.test(String(row.status || ""))).length; const board = await baseRate(session);
  return { role: relation === "REPRESENTS" ? "attorney" : "applicant", total: cases.length, decided: decidedCases.length, approved, approval_rate: decidedCases.length ? Math.round(100 * approved / decidedCases.length) : 0, base_rate: board.base_rate, board_decided: board.decided, cases };
}

async function evidence(session, db, node, keyCases) {
  const terms = [...new Set([nodeCaption(node), ...keyCases].filter(Boolean))];
  const documents = await session.run("MATCH (c:Case)-[:EVIDENCED_BY|HAS_DOCUMENT]->(d:Document) WHERE c.case_number IN $cases RETURN DISTINCT d.doc_id AS doc_id,d.title AS title,d.url AS url,d.source_id AS source_id,c.case_number AS case_number LIMIT 12", { cases: keyCases });
  const output = [];
  if (db) for (const record of documents.records) {
    const row = plain(record); const rawId = String(row.source_id || row.doc_id || "").replace(/^file:/, "");
    const file = rawId ? db.prepare("SELECT name,plaintext,stream_url FROM cc_files WHERE file_id=?").get(rawId) : null;
    output.push({ kind: "doc", title: file?.name || row.title || `Case ${row.case_number}`, snippet: compact(file?.plaintext || `Linked public document for ${row.case_number}.`, terms), url: file?.stream_url || row.url || null });
  }
  if (!output.length && db && keyCases.length) {
    const needle = `%${String(keyCases[0]).toLowerCase()}%`; const file = db.prepare("SELECT name,plaintext,stream_url FROM cc_files WHERE lower(plaintext) LIKE ? LIMIT 3").all(needle);
    for (const row of file) output.push({ kind: "doc", title: row.name || "Public record", snippet: compact(row.plaintext, terms), url: row.stream_url || null });
  }
  if (db && terms.length) {
    let cue = null;
    for (const term of terms.sort((a, b) => String(b).length - String(a).length)) { if (String(term).length < 3) continue; cue = db.prepare("SELECT video_id,start_seconds,text FROM yt_transcript_cues WHERE lower(text) LIKE ? ORDER BY start_seconds LIMIT 1").get(`%${String(term).toLowerCase()}%`); if (cue) break; }
    if (cue) output.push({ kind: "video", title: "Public meeting video", snippet: compact(cue.text, terms), url: `https://www.youtube.com/watch?v=${encodeURIComponent(cue.video_id)}&t=${Math.floor(Number(cue.start_seconds || 0))}s`, videoId: cue.video_id, startSeconds: Number(cue.start_seconds || 0) });
  }
  return output;
}

function fallback(node, facts) { const cases = facts.case_numbers?.filter(Boolean) || []; return `${nodeCaption(node)} is a ${nodeLabel(node)} in the Fishers civic graph.${cases.length ? ` Linked public-record cases: ${cases.join(", ")}.` : " No linked case number is available in this record."}`; }
async function narrative(node, facts) { try { const response = await narrate(facts, "Return {summary}. Write 2-3 concise sentences that only phrase supplied facts. Cite every supplied case_number you mention; never add names, numbers, outcomes, or case numbers."); return { summary: typeof response?.summary === "string" && response.summary.trim() ? response.summary.trim() : fallback(node, facts) }; } catch { return { summary: fallback(node, facts) }; } }

export async function terminalEntity(driver, db, id) {
  const empty = { node: null, stats: [], analytics: {}, connections: [], evidence: [], narrative: { summary: "No dossier is available." } };
  if (!driver || !id) return { ...empty, error: "neo4j_unavailable" };
  const session = driver.session();
  try {
    const found = (await session.run("MATCH (n) WHERE elementId(n)=$id RETURN n LIMIT 1", { id })).records[0]?.get("n"); if (!found) return empty;
    const node = resultNode(found), p = node.props, label = node.label; const linked = await connections(session, id); let analytics = {}, stats = [], cases = [];
    if (label === "Person") {
      const roles = []; if (linked.some((edge) => edge.type === "REPRESENTS")) roles.push("attorney"); if (linked.some((edge) => edge.type === "APPLICANT_FOR")) roles.push("applicant"); if (linked.some((edge) => ["VOTED", "MADE_MOTION"].includes(edge.type))) roles.push("official");
      const attorney = roles.includes("attorney") ? await playerAnalytics(session, id, "REPRESENTS", p.name || null) : null; const applicant = roles.includes("applicant") ? await playerAnalytics(session, id, "APPLICANT_FOR", p.name || null) : null; const primary = attorney || applicant;
      analytics = { roles, attorney, applicant }; cases = primary?.cases || []; stats = primary ? [{ label: "Win rate", value: `${primary.approved} of ${primary.decided} decided approved`, tone: "good" }, { label: "Board avg", value: `${primary.base_rate}%` }, { label: "Land-use cases", value: String(primary.total) }] : [{ label: "Connections", value: String(linked.length) }];
    } else if (label === "Organization") {
      const applicant = await playerAnalytics(session, id, "APPLICANT_FOR"); const attorneys = (await session.run("MATCH (a:Person)-[:REPRESENTS]->(n) WHERE elementId(n)=$id RETURN DISTINCT a.name AS name LIMIT 20", { id })).records.map(plain);
      analytics = { applicant, attorneys }; cases = applicant.cases; stats = [{ label: "Win rate", value: `${applicant.approved} of ${applicant.decided} decided approved`, tone: "good" }, { label: "Board avg", value: `${applicant.base_rate}%` }, { label: "Attorneys", value: String(attorneys.length) }];
    } else if (label === "Case") {
      const details = (await session.run("MATCH (c:Case) WHERE elementId(c)=$id OPTIONAL MATCH (app)-[:APPLICANT_FOR]->(c) OPTIONAL MATCH (att:Person)-[:REPRESENTS]->(app) OPTIONAL MATCH (c)-[:CONCERNS]->(parcel:Parcel) OPTIONAL MATCH (c)-[:REZONE_FROM]->(from:ZoningDistrict) OPTIONAL MATCH (c)-[:REZONE_TO]->(to:ZoningDistrict) OPTIONAL MATCH (s:OpenEntity:Sentiment) WHERE s.source_id=c.source_id RETURN c.status AS status,c.vote_ayes AS vote_ayes,c.vote_nays AS vote_nays,c.opposition_present AS opposition_present,collect(DISTINCT app.name)[0] AS applicant,collect(DISTINCT att.name)[0] AS attorney,collect(DISTINCT parcel.address)[0] AS parcel,collect(DISTINCT from.code)[0] AS rezone_from,collect(DISTINCT to.code)[0] AS rezone_to,collect(DISTINCT coalesce(s.name,s.text,s.sentiment))[0..5] AS opposition", { id })).records[0];
      const detail = plain(details); const prediction = await predict(driver, { case: p.case_number, applicant: detail.applicant || null, opposition_count: detail.opposition?.length || 0 }); analytics = { ...detail, prediction }; cases = [{ case_number: p.case_number, status: detail.status, title: p.title || null }]; stats = [{ label: "Status", value: String(detail.status || "PENDING") }, { label: "Vote", value: detail.vote_ayes == null && detail.vote_nays == null ? "Not recorded" : `${detail.vote_ayes ?? 0}–${detail.vote_nays ?? 0}` }, { label: "Forecast", value: `${prediction.approval_rate ?? 0}% comparable approval` }];
    } else if (label === "Parcel") {
      const detail = (await session.run("MATCH (p:Parcel) WHERE elementId(p)=$id OPTIONAL MATCH (p)-[:OWNED_BY]->(owner) OPTIONAL MATCH (p)-[:CURRENTLY_ZONED]->(zone:ZoningDistrict) OPTIONAL MATCH (c:Case)-[:CONCERNS]->(p) RETURN collect(DISTINCT owner.name)[0] AS owner,collect(DISTINCT zone.code)[0] AS zoning,collect(DISTINCT {case_number:c.case_number,status:c.status,title:c.title}) AS cases", { id })).records[0]; const value = plain(detail); analytics = value; cases = (value.cases || []).filter((item) => item?.case_number); stats = [{ label: "Related cases", value: String(cases.length) }, { label: "Zoning", value: String(value.zoning || "Unmapped") }, { label: "Owner", value: String(value.owner || p.owner_name || "Unmapped") }];
    } else if (label === "Meeting") {
      const detail = (await session.run("MATCH (m:Meeting) WHERE elementId(m)=$id OPTIONAL MATCH (c:Case)-[:HEARD_AT]->(m) OPTIONAL MATCH (m)-[:HAS_DOCUMENT]->(d:Document) RETURN m.board AS board,m.date AS date,collect(DISTINCT {case_number:c.case_number,status:c.status,title:c.title}) AS cases,count(DISTINCT d) AS documents", { id })).records[0]; const value = plain(detail); analytics = value; cases = (value.cases || []).filter((item) => item?.case_number); stats = [{ label: "Cases heard", value: String(cases.length) }, { label: "Documents", value: String(value.documents || 0) }, { label: "Board", value: String(value.board || p.board || "Meeting") }];
    } else stats = [{ label: "Connections", value: String(linked.length) }];
    const caseNumbers = [...new Set(cases.map((item) => item.case_number).filter(Boolean))].slice(0, 12); const receipts = await evidence(session, db, found, caseNumbers);
    const facts = { entity: { label, caption: node.caption }, stats, analytics, case_numbers: caseNumbers, connections: linked.slice(0, 10).map((edge) => ({ type: edge.type, neighbor: edge.neighbor.caption })) };
    return { node, stats, analytics, connections: linked, evidence: receipts, narrative: await narrative(found, facts) };
  } catch { return { ...empty, error: "terminal_unavailable" }; } finally { await session.close(); }
}

export async function terminalGraph(driver, id, hops = 1) {
  if (!driver || !id) return { nodes: [], links: [], error: "neo4j_unavailable" };
  const session = driver.session();
  try {
    const result = await session.run("MATCH (n) WHERE elementId(n)=$id CALL { WITH n MATCH (n)-[r]-(m) OPTIONAL MATCH (m)--() WITH n,r,m,count(*) AS degree RETURN r,m,degree ORDER BY degree DESC LIMIT 119 } RETURN n,collect({r:r,m:m}) AS edges", { id }); const record = result.records[0]; if (!record) return { nodes: [], links: [] };
    const center = record.get("n"), nodes = new Map([[center.elementId, { id: center.elementId, label: nodeLabel(center), caption: nodeCaption(center), group: nodeLabel(center) }]]), links = [];
    for (const edge of record.get("edges") || []) { const r = edge.r, m = edge.m; if (!r || !m) continue; nodes.set(m.elementId, { id: m.elementId, label: nodeLabel(m), caption: nodeCaption(m), group: nodeLabel(m) }); links.push({ source: r.startNodeElementId, target: r.endNodeElementId, type: r.type }); }
    return { nodes: [...nodes.values()].slice(0, 120), links: links.slice(0, 240), counts: { nodes: nodes.size, links: links.length }, hops: Math.min(1, Math.max(1, Number(hops) || 1)) };
  } catch { return { nodes: [], links: [], error: "neo4j_unavailable" }; } finally { await session.close(); }
}
