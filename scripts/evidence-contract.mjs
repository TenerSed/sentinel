import Database from "better-sqlite3";

export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_coverage (
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  covered_location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, covered_location_id)
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  publisher TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('government_record', 'video_transcript', 'reporting')),
  canonical_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_locations (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, location_id)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  retrieved_at TEXT,
  content_hash TEXT,
  raw_text TEXT
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  quote TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('civic_update', 'recent_public_position')),
  page_number INTEGER,
  start_seconds INTEGER,
  end_seconds INTEGER,
  UNIQUE (document_id, ordinal),
  CHECK ((page_number IS NOT NULL AND start_seconds IS NULL AND end_seconds IS NULL) OR
         (page_number IS NULL AND start_seconds IS NOT NULL)),
  CHECK (page_number IS NULL OR page_number > 0),
  CHECK (start_seconds IS NULL OR start_seconds >= 0),
  CHECK (end_seconds IS NULL OR end_seconds >= start_seconds)
);
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id),
  update_type TEXT NOT NULL CHECK (update_type IN ('legislation', 'office_holder', 'policy')),
  title TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  update_id TEXT NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  update_id TEXT REFERENCES updates(id),
  event TEXT NOT NULL CHECK (event IN ('seen', 'query')),
  query_text TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function createDatabase(filename = ":memory:") {
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.exec(schemaSql);
  return database;
}

export function normalizeCanonicalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("canonical URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("canonical URL must be a valid HTTPS URL");
  }
  url.hash = "";
  return url.toString();
}

export function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function validateEvidence({ quote, canonicalUrl, pageNumber, startSeconds, endSeconds }) {
  if (typeof quote !== "string" || wordCount(quote) === 0 || wordCount(quote) > 25) {
    throw new Error("evidence quote must contain 1–25 words");
  }
  const normalizedUrl = normalizeCanonicalUrl(canonicalUrl);
  const hasPage = pageNumber !== undefined && pageNumber !== null;
  const hasTimestamp = startSeconds !== undefined && startSeconds !== null;
  if (hasPage === hasTimestamp) throw new Error("evidence requires exactly one page or timestamp locator");
  if (hasPage && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
    throw new Error("evidence page locator must be a positive integer");
  }
  if (hasTimestamp && (!Number.isInteger(startSeconds) || startSeconds < 0)) {
    throw new Error("evidence timestamp locator must be a non-negative integer");
  }
  if (endSeconds != null && (!hasTimestamp || !Number.isInteger(endSeconds) || endSeconds < startSeconds)) {
    throw new Error("evidence end timestamp must follow its start timestamp");
  }
  return { canonicalUrl: normalizedUrl, quote: quote.trim() };
}

export function insert(database, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((column) => `@${column}`).join(", ");
  database.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(row);
}

export function insertEvidence(database, row) {
  const { canonicalUrl, ...evidenceRow } = row;
  validateEvidence({
    quote: row.quote,
    canonicalUrl,
    pageNumber: row.page_number,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
  });
  evidenceRow.evidence_kind ??= "civic_update";
  if (!['civic_update', 'recent_public_position'].includes(evidenceRow.evidence_kind)) throw new Error("evidence kind is invalid");
  insert(database, "evidence", evidenceRow);
}

export function assertDatabaseIntegrity(database) {
  const foreignKeyProblems = database.pragma("foreign_key_check");
  if (foreignKeyProblems.length) throw new Error(`foreign-key violation: ${JSON.stringify(foreignKeyProblems)}`);
}

export function projectEvidenceForLocation(database, locationId) {
  const rows = database.prepare(`
    WITH allowed_locations AS (
      SELECT covered_location_id AS id FROM location_coverage WHERE location_id = ?
    )
    SELECT
      u.id AS id,
      u.location_id AS locationId,
      requested.label AS locationLabel,
      u.update_type AS updateType,
      s.kind AS sourceKind,
      s.publisher AS publisher,
      d.title AS sourceTitle,
      u.title AS title,
      u.published_at AS publishedAt,
      d.canonical_url AS canonicalUrl,
      e.quote AS exactQuote,
      e.evidence_kind AS evidenceKind,
      e.page_number AS pageNumber,
      e.start_seconds AS startSeconds,
      e.end_seconds AS endSeconds
    FROM updates u
    JOIN documents d ON d.id = u.document_id
    JOIN sources s ON s.id = d.source_id
    JOIN evidence e ON e.document_id = d.id
    JOIN locations requested ON requested.id = u.location_id
    JOIN allowed_locations update_location ON update_location.id = u.location_id
    JOIN source_locations source_location ON source_location.source_id = s.id
    JOIN allowed_locations configured_source_location ON configured_source_location.id = source_location.location_id
    ORDER BY u.published_at DESC, u.id ASC, e.ordinal ASC
  `).all(locationId);

  return rows.map((row) => {
    validateEvidence({
      quote: row.exactQuote,
      canonicalUrl: row.canonicalUrl,
      pageNumber: row.pageNumber,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
    });
    return {
      ...row,
      locator: row.pageNumber == null
        ? { kind: "timestamp", startSeconds: row.startSeconds, ...(row.endSeconds == null ? {} : { endSeconds: row.endSeconds }) }
        : { kind: "page", pageNumber: row.pageNumber },
    };
  });
}
