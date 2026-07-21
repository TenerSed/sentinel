import Database from 'better-sqlite3';
import { graphDriver, counts } from './lib/neo4j.mjs';
import { NODE_KEYS, NODE_LABELS, REL_TYPES, normalizeName, normalizeCase } from './schema.mjs';
import { extract as llmExtract } from './lib/llm.mjs';

const argv = process.argv.slice(2);
const limit = Number(argv.find(x => x.startsWith('--limit='))?.split('=')[1]) || Infinity;
const CONCURRENCY = Number(argv.find(x => x.startsWith('--concurrency='))?.split('=')[1]) || Number(process.env.EXTRACT_CONCURRENCY) || 12;
const extractor = 'llm';

const db = new Database('data/fishers.db');
db.exec('CREATE TABLE IF NOT EXISTS graph_extract_log (source_id TEXT NOT NULL, chunk_ordinal INTEGER NOT NULL, extractor TEXT NOT NULL, processed_at TEXT NOT NULL, status TEXT NOT NULL, error TEXT, PRIMARY KEY(source_id,chunk_ordinal,extractor))');
const driver = graphDriver();

function chunks(text) { const out = []; for (let start = 0, ordinal = 0; start < text.length; start += 5400, ordinal++) out.push({ ordinal, text: text.slice(start, start + 6000), start }); return out; }
function keyFor(node) { let key = node.key || node.props?.[NODE_KEYS[node.label]] || node.props?.name; if (node.label === 'Person' || node.label === 'Organization') key = normalizeName(key); if (node.label === 'Case') key = normalizeCase(key); return node.label === 'Meeting' ? Number(key) : String(key || ''); }
// Neo4j props must be primitives or arrays of primitives. Flatten anything else
// (nested objects, arrays-of-objects) to a JSON string so the write never fails.
function sanitizeProps(p) { const out = {}; for (const [k, v] of Object.entries(p || {})) { if (v == null) continue; if (Array.isArray(v)) { out[k] = v.every(x => x == null || typeof x !== 'object') ? v.filter(x => x != null) : JSON.stringify(v); } else if (typeof v === 'object') { out[k] = JSON.stringify(v); } else { out[k] = v; } } return out; }

async function document(session, ctx) { await session.run('MERGE (d:Document {doc_id:$doc_id}) SET d.source=$source,d.title=$title,d.url=$url,d.source_id=$source_id,d.extractor=$extractor,d.confidence=1.0', { doc_id: ctx.doc_id, source: ctx.source, title: ctx.title, url: ctx.url ?? null, source_id: String(ctx.source_id), extractor: ctx.extractor }); }

async function load(session, result, ctx) {
  for (const node of result.nodes || []) {
    if (!NODE_LABELS.has(node.label)) continue;
    const key = keyFor(node); if (!key) continue;
    const property = NODE_KEYS[node.label];
    const props = { ...(node.props || {}), [property]: key, source: ctx.source, source_id: String(ctx.source_id), extractor: ctx.extractor, confidence: node.props?.confidence ?? .8 };
    if (ctx.start_seconds != null) props.start_seconds = ctx.start_seconds;
    if (props.char_start != null) props.char_start += ctx.char_start || 0;
    if (props.char_end != null) props.char_end += ctx.char_start || 0;
    await session.run(`MERGE (n:${node.label} {${property}:$key}) SET n += $props`, { key, props: sanitizeProps(props) });
  }
  for (const rel of result.relationships || []) {
    if (!REL_TYPES.has(rel.type) || !NODE_LABELS.has(rel.from?.label) || !NODE_LABELS.has(rel.to?.label)) continue;
    const fk = keyFor(rel.from), tk = keyFor(rel.to); if (!fk || !tk) continue;
    const fp = NODE_KEYS[rel.from.label], tp = NODE_KEYS[rel.to.label];
    const props = { ...(rel.props || {}), source: ctx.source, source_id: String(ctx.source_id), extractor: ctx.extractor, confidence: rel.props?.confidence ?? .8 };
    if (ctx.start_seconds != null) props.start_seconds = ctx.start_seconds;
    if (props.char_start != null) props.char_start += ctx.char_start || 0;
    if (props.char_end != null) props.char_end += ctx.char_start || 0;
    await session.run(`MATCH (a:${rel.from.label} {${fp}:$fk}),(b:${rel.to.label} {${tp}:$tk}) MERGE (a)-[r:${rel.type}]->(b) SET r += $props`, { fk, tk, props: sanitizeProps(props) });
  }
}

function transcriptUnits() {
  const rows = db.prepare('SELECT video_id,start_seconds,text FROM yt_transcript_cues ORDER BY video_id,sort_order').all();
  const by = new Map();
  for (const row of rows) { if (!by.has(row.video_id)) by.set(row.video_id, []); by.get(row.video_id).push(row); }
  const units = [];
  for (const [video_id, cues] of by) {
    let text = ''; const offsets = [];
    for (const cue of cues) { offsets.push({ offset: text.length, start_seconds: cue.start_seconds }); text += `${cue.text}\n`; }
    for (const chunk of chunks(text)) {
      const locator = [...offsets].reverse().find(x => x.offset <= chunk.start) || offsets[0];
      units.push({ source_id: video_id, event_id: null, source: 'transcript', title: `YouTube transcript ${video_id}`, doc_id: `video:${video_id}`, url: `https://www.youtube.com/watch?v=${video_id}`, text: chunk.text, char_start: chunk.start, ordinal: chunk.ordinal, start_seconds: locator?.start_seconds });
    }
  }
  return units;
}

// Minutes first (votes/motions/people — highest demo value), then Agenda Packets, then transcripts.
const fileUnits = db.prepare("SELECT file_id source_id,event_id,file_type,name title,stream_url url,plaintext text FROM cc_files WHERE length(trim(coalesce(plaintext,'')))>0 AND file_type IN ('Minutes','Agenda Packet') ORDER BY CASE file_type WHEN 'Minutes' THEN 0 ELSE 1 END, file_id")
  .all().flatMap(row => chunks(row.text).map(chunk => ({ ...row, source: row.file_type === 'Minutes' ? 'minutes' : 'packet', doc_id: `file:${row.source_id}`, ...chunk })));
const allUnits = [...fileUnits, ...transcriptUnits()];

// Skip already-completed chunks (resume), then cap to --limit.
const isDone = db.prepare("SELECT 1 FROM graph_extract_log WHERE source_id=? AND chunk_ordinal=? AND extractor=? AND status='ok'");
const pending = allUnits.filter(u => !isDone.get(String(u.source_id), u.ordinal, extractor)).slice(0, limit === Infinity ? undefined : limit);

const logOk = db.prepare("INSERT OR REPLACE INTO graph_extract_log VALUES (?,?,?,?,?,?)");
let done = 0, emitted = 0, failed = 0, next = 0;
const total = pending.length;

async function worker() {
  const session = driver.session();
  try {
    while (next < pending.length) {
      const unit = pending[next++];
      const ctx = { ...unit, extractor };
      try {
        await document(session, ctx);
        const result = await llmExtract(unit.text);
        await load(session, result, ctx);
        logOk.run(String(unit.source_id), unit.ordinal, extractor, new Date().toISOString(), 'ok', null);
        done++; emitted += result.nodes?.length || 0;
      } catch (error) {
        logOk.run(String(unit.source_id), unit.ordinal, extractor, new Date().toISOString(), 'error', String(error.message).slice(0, 300));
        failed++;
      }
      if ((done + failed) % 25 === 0) console.log(`extract progress ${done + failed}/${total} (ok=${done} fail=${failed})`);
    }
  } finally { await session.close(); }
}

try {
  console.log(`extracting ${total} pending chunks with concurrency ${CONCURRENCY}`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total || 1) }, worker));
  console.log(JSON.stringify({ processed: done, emitted_nodes: emitted, failed, counts: await counts(driver) }, null, 2));
} finally { db.close(); await driver.close(); }
