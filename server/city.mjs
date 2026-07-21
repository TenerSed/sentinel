import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureCache, readCache, writeCache } from "./cache.mjs";
import { pdfToText } from "../scripts/fishers/lib/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The single canonical runtime database. Onboarding used to write
 * data/lamplighter.db while the HTTP layer served data/fishers.db, so ingested
 * cities were unreachable by construction. Both sides now resolve the path
 * through this one function; there is no second database to drift from.
 */
export function resolveRuntimeDbPath() {
  if (process.env.SENTINEL_DB) return path.resolve(root, process.env.SENTINEL_DB);
  const found = [
    path.join(root, "data", "fishers.db"),
    path.join(root, "data", "demo.db"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("No Sentinel runtime database was found.");
  return found;
}

export const cityDbPath = resolveRuntimeDbPath();

export const citySlug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const clean = (value, max = 300) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * Every onboarded-city table lives in the same database the onboarding flow
 * writes to. Before this module the ingest wrote `onboarded_meetings` into
 * data/lamplighter.db while the HTTP layer only ever read data/fishers.db,
 * which is why ingested cities produced a count on screen and nothing else.
 */
export function openCityDb() {
  const db = new Database(cityDbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarded_meetings (
      city TEXT NOT NULL,
      vendor TEXT NOT NULL,
      slug TEXT NOT NULL,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT,
      start_datetime TEXT,
      raw_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (city, vendor, slug, event_id)
    );
    CREATE TABLE IF NOT EXISTS onboarded_documents (
      city_slug TEXT NOT NULL,
      vendor TEXT NOT NULL,
      slug TEXT NOT NULL,
      event_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      name TEXT,
      file_type TEXT,
      source_url TEXT,
      chars INTEGER NOT NULL DEFAULT 0,
      plaintext TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (city_slug, file_id)
    );
    CREATE TABLE IF NOT EXISTS onboard_checkpoint (
      city_slug TEXT NOT NULL,
      stage TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      done_at TEXT NOT NULL,
      PRIMARY KEY (city_slug, stage, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_onboarded_documents_event ON onboarded_documents(city_slug, event_id);
  `);
  // Columns must exist before any index references them: `onboarded_meetings`
  // predates city_slug/portal_url, so migrate first, then index.
  ensureCitySlugColumn(db);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_onboarded_meetings_slug ON onboarded_meetings(city_slug)",
  );
  return db;
}

// `city_slug` is added defensively: the table predates this column.
function ensureCitySlugColumn(db) {
  const columns = db.prepare("PRAGMA table_info(onboarded_meetings)").all();
  if (!columns.some((column) => column.name === "city_slug")) {
    db.exec("ALTER TABLE onboarded_meetings ADD COLUMN city_slug TEXT");
  }
  if (!columns.some((column) => column.name === "portal_url")) {
    db.exec("ALTER TABLE onboarded_meetings ADD COLUMN portal_url TEXT");
  }
  db.exec(
    "UPDATE onboarded_meetings SET city_slug = lower(replace(trim(city),' ','-')) WHERE city_slug IS NULL OR city_slug = ''",
  );
}

export function withCityDb(fn) {
  const db = openCityDb();
  try {
    ensureCitySlugColumn(db);
    ensureCache(db);
    return fn(db);
  } finally {
    db.close();
  }
}

export function portalUrlFor(vendor, slug, eventId) {
  if (vendor === "civicclerk")
    return eventId
      ? `https://${slug}.portal.civicclerk.com/event/${eventId}/overview`
      : `https://${slug}.portal.civicclerk.com/`;
  if (vendor === "legistar")
    return eventId
      ? `https://${slug}.legistar.com/MeetingDetail.aspx?ID=${eventId}`
      : `https://${slug}.legistar.com/Calendar.aspx`;
  if (vendor === "primegov")
    return eventId
      ? `https://${slug}.primegov.com/Portal/Meeting?meetingTemplateId=${eventId}`
      : `https://${slug}.primegov.com/public/portal`;
  return null;
}

/**
 * Recomputes and caches the per-city summary the UI reads. Called at the end of
 * ingest so page loads never touch an LLM, Neo4j, or the vendor API.
 */
export function rebuildCitySummary(db, slugValue, extra = {}) {
  const slug = citySlug(slugValue);
  if (!slug) return null;
  const meetings = db
    .prepare(
      "SELECT count(*) AS total, min(start_datetime) AS earliest, max(start_datetime) AS latest FROM onboarded_meetings WHERE city_slug = ?",
    )
    .get(slug);
  const documents = db
    .prepare(
      "SELECT count(*) AS total, coalesce(sum(chars),0) AS chars FROM onboarded_documents WHERE city_slug = ?",
    )
    .get(slug);
  const identity = db
    .prepare(
      "SELECT city, vendor, slug FROM onboarded_meetings WHERE city_slug = ? LIMIT 1",
    )
    .get(slug);
  const bodies = db
    .prepare(
      "SELECT body AS name, count(*) AS meetings FROM onboarded_meetings WHERE city_slug = ? AND body IS NOT NULL AND body <> '' GROUP BY body ORDER BY meetings DESC LIMIT 12",
    )
    .all(slug);
  const previous = readCache(db, `city:${slug}`) || {};
  const documentsTotal = Number(documents?.total || 0);
  const payload = {
    citySlug: slug,
    city: extra.city || identity?.city || previous.city || slug,
    state: extra.state || previous.state || null,
    vendor: extra.vendor || identity?.vendor || previous.vendor || null,
    vendorSlug: extra.vendorSlug || identity?.slug || previous.vendorSlug || null,
    portalUrl:
      portalUrlFor(
        extra.vendor || identity?.vendor,
        extra.vendorSlug || identity?.slug,
      ) || previous.portalUrl || null,
    meetings: Number(meetings?.total || 0),
    earliestMeeting: meetings?.earliest || null,
    latestMeeting: meetings?.latest || null,
    documents: documentsTotal,
    documentChars: Number(documents?.chars || 0),
    bodies,
    // Honest labelling: only Fishers has the full graph/entity extraction.
    depth: documentsTotal > 0 ? "documents-ingested" : "meetings-ingested",
    depthLabel:
      documentsTotal > 0
        ? "Meetings and documents ingested — entity extraction pending"
        : "Meetings ingested — deep extraction pending",
    fullyIndexed: false,
    updatedAt: new Date().toISOString(),
    ...(extra.errors ? { errors: extra.errors } : {}),
  };
  writeCache(db, `city:${slug}`, payload);
  return payload;
}

export function listCities() {
  return withCityDb((db) => {
    const rows = db
      .prepare("SELECT payload FROM app_cache WHERE key LIKE 'city:%'")
      .all();
    const cities = rows
      .flatMap((row) => {
        try {
          return [JSON.parse(row.payload)];
        } catch {
          return [];
        }
      })
      .filter((city) => city && city.citySlug)
      .sort((a, b) => (b.meetings || 0) - (a.meetings || 0));
    return { cities };
  });
}

export function cityDetail(slugValue, options = {}) {
  const slug = citySlug(slugValue);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 300);
  if (!slug)
    throw Object.assign(new Error("A city slug is required."), {
      status: 400,
      code: "invalid_city",
    });
  return withCityDb((db) => {
    const summary = readCache(db, `city:${slug}`) || rebuildCitySummary(db, slug);
    if (!summary || !summary.meetings)
      throw Object.assign(
        new Error(
          `No ingested data for "${slug}". Onboard the city first — nothing is shown from another city's records.`,
        ),
        { status: 404, code: "city_not_ingested" },
      );
    const offset = Math.max(Number(options.offset) || 0, 0);
    const search = String(options.q || "").trim().slice(0, 120);
    const body = String(options.body || "").trim().slice(0, 120);
    const filters = ["m.city_slug = @slug"];
    const params = { slug, limit, offset };
    if (search) {
      filters.push("(m.name LIKE @search OR m.body LIKE @search)");
      params.search = `%${search}%`;
    }
    if (body) {
      filters.push("m.body = @body");
      params.body = body;
    }
    const where = filters.join(" AND ");
    const matched = db
      .prepare(`SELECT count(*) AS total FROM onboarded_meetings m WHERE ${where}`)
      .get(params);
    const meetings = db
      .prepare(
        `SELECT m.event_id, m.name, m.body, m.start_datetime, m.vendor, m.slug, m.portal_url,
                (SELECT count(*) FROM onboarded_documents d WHERE d.city_slug = m.city_slug AND d.event_id = m.event_id) AS documents,
                (SELECT coalesce(sum(d.chars),0) FROM onboarded_documents d WHERE d.city_slug = m.city_slug AND d.event_id = m.event_id) AS document_chars
         FROM onboarded_meetings m
         WHERE ${where}
         ORDER BY m.start_datetime DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params)
      .map((row) => ({
        eventId: row.event_id,
        name: row.name,
        body: row.body || null,
        startDateTime: row.start_datetime || null,
        documents: Number(row.documents || 0),
        documentChars: Number(row.document_chars || 0),
        url: row.portal_url || portalUrlFor(row.vendor, row.slug, row.event_id),
      }));
    return {
      ...summary,
      // `meetings` on the summary is a count; here it is the page of rows. Keep
      // the count under an unambiguous key so clients never render an array.
      meetingsTotal: Number(summary.meetings || 0),
      meetings,
      page: {
        total: Number(matched?.total || 0),
        limit,
        offset,
        hasMore: offset + meetings.length < Number(matched?.total || 0),
      },
    };
  });
}

export function cityDocuments(slugValue, options = {}) {
  const slug = citySlug(slugValue);
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  return withCityDb((db) => {
    const rows = db
      .prepare(
        `SELECT event_id, file_id, name, file_type, source_url, chars, substr(plaintext,1,600) AS excerpt, fetched_at
         FROM onboarded_documents WHERE city_slug = ? ORDER BY chars DESC LIMIT ?`,
      )
      .all(slug, limit);
    return {
      citySlug: slug,
      documents: rows.map((row) => ({
        eventId: row.event_id,
        fileId: row.file_id,
        name: row.name,
        fileType: row.file_type,
        url: row.source_url,
        chars: Number(row.chars || 0),
        excerpt: row.excerpt || "",
        fetchedAt: row.fetched_at,
      })),
    };
  });
}

async function fetchBuffer(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Lamplighter civic document ingest/1.0" },
    });
    if (!response.ok)
      throw Object.assign(new Error(`HTTP ${response.status}`), {
        status: response.status,
      });
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function extractText(bytes) {
  const head = bytes.subarray(0, 5).toString("latin1");
  if (head.startsWith("%PDF")) {
    const result = await pdfToText(bytes);
    return { text: result.text || "", error: result.error || null };
  }
  const text = bytes.toString("utf8");
  // Reject HTML error pages masquerading as documents.
  if (/^\s*<(!doctype|html)/i.test(text))
    return { text: "", error: "response was HTML, not a document" };
  return { text: text.trim(), error: null };
}

function civicclerkTargets(vendorSlug, meeting) {
  const raw = JSON.parse(meeting.raw_json || "{}");
  const wanted = ["Agenda", "Agenda Packet", "Minutes"];
  return (raw.publishedFiles || [])
    .filter((file) => wanted.includes(file.type))
    .map((file) => ({
      fileId: String(file.fileId),
      name: clean(file.name, 200) || file.type,
      fileType: file.type,
      urls: [
        `https://${vendorSlug}.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=true)`,
        `https://${vendorSlug}.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`,
      ],
    }));
}

function legistarTargets(meeting) {
  const raw = JSON.parse(meeting.raw_json || "{}");
  const out = [];
  if (raw.EventAgendaFile)
    out.push({
      fileId: `${raw.EventId}-agenda`,
      name: "Agenda",
      fileType: "Agenda",
      urls: [raw.EventAgendaFile],
    });
  if (raw.EventMinutesFile)
    out.push({
      fileId: `${raw.EventId}-minutes`,
      name: "Minutes",
      fileType: "Minutes",
      urls: [raw.EventMinutesFile],
    });
  return out;
}

function primegovTargets(vendorSlug, meeting) {
  const raw = JSON.parse(meeting.raw_json || "{}");
  // PrimeGov exposes compiled agenda/minutes PDFs on a public route keyed by the
  // document's templateId. compileOutputType 1 is the PDF; 3 is an HTML view
  // that sits behind the tenant login, so only 1 is worth fetching.
  const seen = new Set();
  return (raw.documentList || [])
    .filter((file) => Number(file?.compileOutputType) === 1 && file?.templateId)
    .filter((file) => {
      const key = String(file.templateId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((file) => ({
      fileId: `${raw.id}-${file.templateId}`,
      name: clean(file.templateName, 200) || "Agenda",
      fileType: clean(file.templateName, 60) || "Agenda",
      urls: [
        `https://${vendorSlug}.primegov.com/Public/CompiledDocument?meetingTemplateId=${file.templateId}&compileOutputType=1&isPublic=true`,
      ],
    }));
}

/**
 * Pulls agenda/minutes text for the most recent meetings of an onboarded city.
 * Idempotent and resumable: every attempt writes an `onboard_checkpoint` row, so
 * a re-run skips meetings already handled and only retries failures.
 */
export async function ingestCityDocuments(options = {}) {
  const slug = citySlug(options.citySlug);
  const maxMeetings = Math.min(Number(options.maxMeetings) || 25, 200);
  const budgetMs = Math.min(Number(options.budgetMs) || 120_000, 600_000);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const started = Date.now();
  const stats = { meetingsScanned: 0, documents: 0, chars: 0, failures: [], budgetExhausted: false };
  if (!slug) return stats;

  const db = openCityDb();
  try {
    ensureCitySlugColumn(db);
    ensureCache(db);
    const meetings = db
      .prepare(
        `SELECT m.event_id, m.vendor, m.slug, m.raw_json FROM onboarded_meetings m
         WHERE m.city_slug = ?
           AND NOT EXISTS (SELECT 1 FROM onboard_checkpoint c
                           WHERE c.city_slug = m.city_slug AND c.stage = 'documents'
                             AND c.event_id = m.event_id AND c.status = 'ok')
         ORDER BY m.start_datetime DESC LIMIT ?`,
      )
      .all(slug, maxMeetings);

    const insertDoc = db.prepare(
      `INSERT INTO onboarded_documents
        (city_slug,vendor,slug,event_id,file_id,name,file_type,source_url,chars,plaintext,fetched_at)
       VALUES (@city_slug,@vendor,@slug,@event_id,@file_id,@name,@file_type,@source_url,@chars,@plaintext,@fetched_at)
       ON CONFLICT(city_slug,file_id) DO UPDATE SET
        chars=excluded.chars, plaintext=excluded.plaintext, source_url=excluded.source_url,
        name=excluded.name, file_type=excluded.file_type, fetched_at=excluded.fetched_at`,
    );
    const checkpoint = db.prepare(
      `INSERT INTO onboard_checkpoint (city_slug,stage,event_id,status,note,done_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(city_slug,stage,event_id) DO UPDATE SET
        status=excluded.status, note=excluded.note, done_at=excluded.done_at`,
    );

    for (const meeting of meetings) {
      if (Date.now() - started > budgetMs) {
        stats.budgetExhausted = true;
        break;
      }
      stats.meetingsScanned += 1;
      const targets =
        meeting.vendor === "civicclerk"
          ? civicclerkTargets(meeting.slug, meeting)
          : meeting.vendor === "primegov"
            ? primegovTargets(meeting.slug, meeting)
            : legistarTargets(meeting);
      if (!targets.length) {
        checkpoint.run(slug, "documents", meeting.event_id, "ok", "no attachments published", new Date().toISOString());
        onProgress(stats);
        continue;
      }
      let ok = 0;
      let lastError = null;
      for (const target of targets) {
        let text = "";
        let usedUrl = null;
        for (const url of target.urls) {
          try {
            const bytes = await fetchBuffer(url);
            const extracted = await extractText(bytes);
            if (extracted.text) {
              text = extracted.text;
              usedUrl = url;
              break;
            }
            lastError = extracted.error || "no text extracted";
          } catch (error) {
            lastError = error.message;
          }
        }
        if (!text) continue;
        insertDoc.run({
          city_slug: slug,
          vendor: meeting.vendor,
          slug: meeting.slug,
          event_id: meeting.event_id,
          file_id: target.fileId,
          name: target.name,
          file_type: target.fileType,
          source_url: usedUrl,
          chars: text.length,
          plaintext: text,
          fetched_at: new Date().toISOString(),
        });
        ok += 1;
        stats.documents += 1;
        stats.chars += text.length;
      }
      checkpoint.run(
        slug,
        "documents",
        meeting.event_id,
        ok ? "ok" : "failed",
        ok ? `${ok} document(s)` : clean(lastError || "no text extracted", 200),
        new Date().toISOString(),
      );
      if (!ok && lastError && stats.failures.length < 5)
        stats.failures.push(`event ${meeting.event_id}: ${clean(lastError, 160)}`);
      onProgress(stats);
    }
    rebuildCitySummary(db, slug);
  } finally {
    db.close();
  }
  return stats;
}
