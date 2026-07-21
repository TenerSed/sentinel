import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DB_PATH = path.resolve('data/fishers.db');
export const now = () => new Date().toISOString();

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cc_events (event_id INTEGER PRIMARY KEY, event_name TEXT, category_name TEXT, event_date TEXT, start_datetime TEXT, agenda_id INTEGER, agenda_name TEXT, is_published TEXT, youtube_video_id TEXT, cc_source_path TEXT, keywords TEXT, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS cc_files (file_id INTEGER PRIMARY KEY, event_id INTEGER, file_type TEXT, name TEXT, stream_url TEXT, has_plaintext INTEGER, plaintext TEXT, local_pdf_path TEXT, pdf_page_count INTEGER, sha256 TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS cc_agenda_items (item_id INTEGER PRIMARY KEY, event_id INTEGER, agenda_id INTEGER, outline_number TEXT, name TEXT, description_html TEXT, resolution_number TEXT, ordinance_number TEXT, resolution_formatted TEXT, ordinance_formatted TEXT, presenter_name TEXT, fiscal_impact_summary TEXT, pass_fail TEXT, has_motion INTEGER, has_vote INTEGER, has_speaker INTEGER, sort_order INTEGER, parent_item_id INTEGER, minutes_html TEXT, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS cc_item_attachments (attachment_id INTEGER PRIMARY KEY, item_id INTEGER, event_id INTEGER, file_name TEXT, content_type TEXT, doc_type_id INTEGER, pdf_full_path TEXT, txt_full_path TEXT, local_path TEXT, is_published INTEGER, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS cc_votes (vote_id TEXT PRIMARY KEY, item_id INTEGER, event_id INTEGER, motion_text TEXT, moved_by TEXT, seconded_by TEXT, outcome TEXT, ayes INTEGER, nays INTEGER, abstain INTEGER, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS cc_vote_records (id INTEGER PRIMARY KEY AUTOINCREMENT, vote_id TEXT, item_id INTEGER, person_name TEXT, vote_value TEXT, raw_json TEXT, UNIQUE(vote_id, person_name, vote_value));
    CREATE TABLE IF NOT EXISTS yt_transcripts (video_id TEXT PRIMARY KEY, event_id INTEGER, source TEXT, language TEXT, status TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS yt_transcript_cues (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT, start_seconds REAL, duration_seconds REAL, text TEXT, sort_order INTEGER, UNIQUE(video_id, sort_order));
    CREATE TABLE IF NOT EXISTS parcels (object_id INTEGER PRIMARY KEY, parcel_no TEXT, st_parcel_no TEXT, local_address TEXT, owner_name TEXT, deeded_owner TEXT, own_address TEXT, legal_desc TEXT, prop_class TEXT, prop_use TEXT, tax_dist_name TEXT, deed_acres REAL, av_land REAL, av_improve REAL, av_total_gross REAL, tax_year TEXT, subdiv_name TEXT, property_report_url TEXT, geometry_geojson TEXT, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS zoning_districts (object_id TEXT PRIMARY KEY, district_code TEXT, district_name TEXT, geometry_geojson TEXT, raw_json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS ingest_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, mode TEXT, started_at TEXT, finished_at TEXT, high_watermark TEXT, rows_upserted INTEGER, errors INTEGER, status TEXT, notes TEXT);
  `);
  // Layer 1 and 2 both use numeric OBJECTIDs. Convert the original integer-key
  // table once so the extractor can store collision-proof keys such as `2:1`.
  const zoningSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='zoning_districts'").get()?.sql || '';
  if (/object_id INTEGER PRIMARY KEY/i.test(zoningSql)) {
    db.exec(`
      CREATE TABLE zoning_districts_rekeyed (object_id TEXT PRIMARY KEY, district_code TEXT, district_name TEXT, geometry_geojson TEXT, raw_json TEXT, fetched_at TEXT);
      INSERT INTO zoning_districts_rekeyed SELECT CAST(object_id AS TEXT), district_code, district_name, geometry_geojson, raw_json, fetched_at FROM zoning_districts;
      DROP TABLE zoning_districts;
      ALTER TABLE zoning_districts_rekeyed RENAME TO zoning_districts;
    `);
  }
  return db;
}

export function startRun(db, source, mode) { return db.prepare('INSERT INTO ingest_runs (source,mode,started_at,rows_upserted,errors,status,notes) VALUES (?,?,?,?,?,?,?)').run(source, mode, now(), 0, 0, 'running', ''); }
export function finishRun(db, id, { rows = 0, errors = 0, watermark = null, notes = '', status = 'completed' }) { db.prepare('UPDATE ingest_runs SET finished_at=?, high_watermark=?, rows_upserted=?, errors=?, status=?, notes=? WHERE id=?').run(now(), watermark, rows, errors, status, notes, id); }
export function args() { const a = process.argv.slice(2); return { mode: a.includes('--live') ? 'live' : 'backfill', limit: Number(a.find(x => x.startsWith('--limit='))?.split('=')[1]) || null }; }
