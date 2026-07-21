// Entity-resolution pass over the extracted graph.
// The LLM over-created ZoningDistrict nodes: real codes appear in inconsistent
// forms ("C1", "C1 Commercial District", "c-1") and a large amount of junk was
// mislabeled as zoning (street names, addresses, subdivisions, tree species,
// UUIDs, OCR garbage). This script:
//   1. Normalizes each ZoningDistrict code and MERGES duplicates that normalize
//      to the same canonical code (moving their relationships onto one node).
//   2. Deletes ZoningDistrict nodes whose code is not a plausible zoning code
//      (detaching their hallucinated edges).
// Person/Organization growth is legitimate (real people/orgs named in the text),
// so those are left untouched.
import { graphDriver } from './lib/neo4j.mjs';

// Canonicalize a raw zoning label. Returns null if it is not a plausible code.
function canonZoning(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toUpperCase();
  // strip descriptive suffixes the LLM appended
  s = s.replace(/\s+(COMMERCIAL\s+)?(LOW-?IMPACT\s+)?DISTRICT$/,'').replace(/\s+STANDARDS$/,'').replace(/\s+WITH\s+CONDITIONS$/,'').replace(/\s+ZONING$/,'').trim();
  s = s.replace(/\s+/g,' ').trim();
  // overlays and PUDs pass through (normalized spacing)
  if (/OVERLAY$/.test(s)) return s.replace(/\s+/g,' ');
  if (/\bPUD\b/.test(s) || /PUD$/.test(s)) return s.replace(/\s+/g,' ');
  // strict base-district codes: AG, A2, R1..R5(+c), C1..C3(+c), B-1, I1, M1/M2, plus named 2-3 letter districts
  const compact = s.replace(/[\s-]/g,'');
  if (/^(AG(OS)?|A\d|R\d+C?|C\d+C?|CLOW|B\d|I\d|M\d|DC|TC|VC|MC|MA|HC|EN|OM|OS)$/.test(compact)) {
    // re-expand a couple of canonical hyphenated forms
    if (compact==='CLOW') return 'C-Low';
    if (/^B\d$/.test(compact)) return `B-${compact.slice(1)}`;
    return compact;
  }
  return null; // junk
}

const driver = graphDriver();
const s = driver.session();
try {
  const before = (await s.run('MATCH (z:ZoningDistrict) RETURN count(z) AS c')).records[0].get('c').toNumber();
  const rows = (await s.run('MATCH (z:ZoningDistrict) RETURN z.code AS code')).records.map(r => r.get('code'));

  // Bucket every existing code by its canonical form (or mark as junk).
  const groups = new Map(); const junk = [];
  for (const code of rows) {
    const canon = canonZoning(code);
    if (!canon) { junk.push(code); continue; }
    if (!groups.has(canon)) groups.set(canon, new Set());
    groups.get(canon).add(code);
  }

  let merged = 0, canonCreated = 0;
  for (const [canon, variants] of groups) {
    // Ensure the canonical node exists, then merge every variant node into it via APOC.
    await s.run('MERGE (:ZoningDistrict {code:$canon})', { canon });
    const others = [...variants].filter(v => v !== canon);
    if (others.length) {
      await s.run(
        `MATCH (target:ZoningDistrict {code:$canon})
         MATCH (v:ZoningDistrict) WHERE v.code IN $others
         WITH target, collect(v) AS vs
         CALL apoc.refactor.mergeNodes([target]+vs, {properties:'discard', mergeRels:true}) YIELD node
         RETURN count(node)`,
        { canon, others });
      merged += others.length;
    } else if (!variants.has(canon)) { canonCreated++; }
  }

  // Delete junk zoning nodes and their hallucinated relationships.
  const del = await s.run('MATCH (z:ZoningDistrict) WHERE z.code IN $junk DETACH DELETE z RETURN count(z) AS c', { junk });
  const deleted = del.records[0].get('c').toNumber();

  const after = (await s.run('MATCH (z:ZoningDistrict) RETURN count(z) AS c')).records[0].get('c').toNumber();
  const kept = (await s.run('MATCH (z:ZoningDistrict) RETURN z.code AS code ORDER BY code')).records.map(r => r.get('code'));
  console.log(JSON.stringify({ before, merged_variant_nodes: merged, junk_deleted: deleted, after, kept_codes: kept }, null, 2));
} finally { await s.close(); await driver.close(); }
