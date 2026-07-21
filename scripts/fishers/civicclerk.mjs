import crypto from 'node:crypto';
import { openDb, startRun, finishRun, args, now } from './db.mjs';
import { request, json } from './lib/http.mjs';
import { pdfToText } from './lib/pdf.mjs';

const BASE = 'https://fishersin.api.civicclerk.com/v1';
const eventSql = `INSERT INTO cc_events VALUES (@event_id,@event_name,@category_name,@event_date,@start_datetime,@agenda_id,@agenda_name,@is_published,@youtube_video_id,@cc_source_path,@keywords,@raw_json,@fetched_at) ON CONFLICT(event_id) DO UPDATE SET event_name=excluded.event_name,category_name=excluded.category_name,event_date=excluded.event_date,start_datetime=excluded.start_datetime,agenda_id=excluded.agenda_id,agenda_name=excluded.agenda_name,is_published=excluded.is_published,youtube_video_id=excluded.youtube_video_id,cc_source_path=excluded.cc_source_path,keywords=excluded.keywords,raw_json=excluded.raw_json,fetched_at=excluded.fetched_at`;
const fileSql = `INSERT INTO cc_files VALUES (@file_id,@event_id,@file_type,@name,@stream_url,@has_plaintext,@plaintext,@local_pdf_path,@pdf_page_count,@sha256,@fetched_at) ON CONFLICT(file_id) DO UPDATE SET event_id=excluded.event_id,file_type=excluded.file_type,name=excluded.name,stream_url=excluded.stream_url,has_plaintext=excluded.has_plaintext,plaintext=excluded.plaintext,local_pdf_path=excluded.local_pdf_path,pdf_page_count=excluded.pdf_page_count,sha256=excluded.sha256,fetched_at=excluded.fetched_at`;

function eventRow(e) { return { event_id:e.id, event_name:e.eventName, category_name:e.categoryName, event_date:e.eventDate, start_datetime:e.startDateTime, agenda_id:e.agendaId, agenda_name:e.agendaName, is_published:e.isPublished, youtube_video_id:e.youtubeVideoId, cc_source_path:e.closedCaptionSourcePath, keywords:e.keywords, raw_json:JSON.stringify(e), fetched_at:now() }; }
async function getFile(file) {
  const params = `fileId=${file.fileId},fileType=${file.fileType || 1},plainText=true`;
  // Fishers returns 500 for Event streams for some otherwise public files. The
  // Meeting stream is the working fallback discovered against the live API.
  let response;
  try { response = await request(`${BASE}/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=true)`); } catch { /* try Event stream below */ }
  if (!response?.ok) response = await request(`${BASE}/Events/GetEventFileStream(${params})`);
  if (response?.ok) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8').trim();
    if (text && !text.startsWith('%PDF')) return { text, bytes, isPdf:false };
  }
  // The Event PDF stream returns 500 for several Fishers files; use the same
  // working Meeting stream directly for the binary fallback.
  const pdfResponse = await request(`${BASE}/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`);
  if (!pdfResponse.ok) throw new Error(`file ${file.fileId}: ${pdfResponse.status}`);
  const bytes = Buffer.from(await pdfResponse.arrayBuffer());
  return { ...(await pdfToText(bytes)), bytes, isPdf:true };
}
async function ingestFile(db, eventId, file) {
  const got = await getFile(file);
  // PDFs are transient: text is already extracted into the DB above, so we do
  // not persist the raw bytes to disk (avoids unbounded data/raw growth on a
  // constrained disk). Re-run the ingest to re-fetch a PDF if ever needed.
  let local = null;
  db.prepare(fileSql).run({ file_id:file.fileId, event_id:eventId, file_type:file.type, name:file.name, stream_url:file.streamUrl || file.url || null, has_plaintext:got.text ? 1 : 0, plaintext:got.text || '', local_pdf_path:local, pdf_page_count:got.pages || null, sha256:crypto.createHash('sha256').update(got.bytes).digest('hex'), fetched_at:now() });
}
async function tryItems(db, event) {
  // CivicClerk's public OData Meeting endpoint is /Meetings?$filter=eventId eq N.
  const data = await json(`${BASE}/Meetings?%24filter=eventId%20eq%20${event.id}`);
  const meeting = data.value?.[0]; const items = meeting?.agendaObjItems || meeting?.agendaObjectItems || [];
  for (const x of items) db.prepare(`INSERT INTO cc_agenda_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET raw_json=excluded.raw_json,fetched_at=excluded.fetched_at`).run(x.id,event.id,event.agendaId,x.agendaObjectItemOutlineNumberFull,x.agendaObjectItemName,x.agendaObjectItemDescription,x.resolutionNumber,x.ordinanceNumber,x.resolutionFormattedNumber,x.ordinanceFormattedNumber,x.presenterName,x.fiscalImpactSummary,x.passFail,+!!x.hasMotion,+!!x.hasVote,+!!x.hasSpeaker,x.sortOrder,x.parentId,x.agendaObjectItemMinutesHtmlContent,JSON.stringify(x),now());
  return items.length;
}

async function main() {
  const { mode, limit } = args(), db = openDb(), run = startRun(db, 'civicclerk', mode).lastInsertRowid;
  let rows=0, errors=0, skip=0, events=[]; const notes=[];
  try {
    const watermark = mode === 'live' ? db.prepare('SELECT max(start_datetime) v FROM cc_events').get().v : null;
    const filter = watermark ? `startDateTime ge ${watermark}` : 'startDateTime ge 2026-01-01T00:00:00Z';
    // CivicClerk caps this endpoint at 15 rows even when %24top=50. Page until
    // it returns no rows and advance by the page actually received.
    while (!limit || events.length < limit) { const page=await json(`${BASE}/Events?%24filter=${encodeURIComponent(filter)}&%24orderby=startDateTime%20asc&%24top=50&%24skip=${skip}`); const values=page.value || []; if (!values.length) break; events.push(...values); skip += values.length; }
    if (limit) events=events.slice(0,limit);
    const upsertEvent=db.prepare(eventSql);
    let agendaItemsUnavailable = false;
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) { const event = events[eventIndex]; try { upsertEvent.run(eventRow(event)); rows++;
      // The list response already includes publishedFiles; avoid a redundant per-event
      // detail request. The public endpoint's Meeting item route is probed once only.
      for (const file of event.publishedFiles || []) { if (!['Agenda','Agenda Packet','Minutes'].includes(file.type)) continue; try { await ingestFile(db,event.id,file); rows++; } catch (error) { errors++; notes.push(`file ${file.fileId}: ${error.message}`); } }
      if (!agendaItemsUnavailable) try { rows += await tryItems(db,event); } catch (error) { agendaItemsUnavailable=true; notes.push(`agenda items endpoint unavailable: ${error.message}`); }
    } catch (error) { errors++; notes.push(`event ${event.id}: ${error.message}`); }
      if ((eventIndex + 1) % 10 === 0) console.log(`civicclerk progress ${eventIndex + 1}/${events.length}`);
    }
    finishRun(db,run,{rows,errors,watermark:events.at(-1)?.startDateTime || null,notes:notes.join('\n').slice(0,8000),status:'completed'});
  } catch (error) { errors++; notes.push(`run error: ${error.message}`); finishRun(db,run,{rows,errors,notes:notes.join('\n'),status:'completed'}); }
  console.log(JSON.stringify({ source:'civicclerk', events:db.prepare('SELECT count(*) n FROM cc_events').get().n, files:db.prepare('SELECT count(*) n FROM cc_files').get().n, rows, errors },null,2)); db.close();
}
main();
