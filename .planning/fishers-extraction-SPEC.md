# Fishers Civic Data — Extraction Pipeline SPEC

Build a **raw data extraction pipeline** into SQLite. **Extraction only — NO graph/relations/entity-resolution/cross-source linking.** Store the natural join keys as plain columns (`event_id`, `youtube_video_id`, `parcel_no`) so a graph can be built later, but do not build any joins now.

## Non-negotiables
- Node ESM (`.mjs`), `better-sqlite3` (already a dep), native `fetch`. No new heavy frameworks.
- Idempotent upserts everywhere (`INSERT ... ON CONFLICT(pk) DO UPDATE`). Re-running must not duplicate.
- Two modes per source: `backfill` (full, from 2026-01-01) and `live` (incremental via high-watermark). Default = backfill.
- Polite: sequential or small concurrency (≤4), 200–500ms jitter between requests, retry w/ exponential backoff (3 tries) on 429/5xx. Set a descriptive `User-Agent`.
- Record every run in `ingest_runs`. Never crash the whole run because one event/file failed — log the error row and continue.
- Store to a **separate** DB `data/fishers.db` (do not touch `data/lamplighter.db`).
- Raw payloads: keep `raw_json` TEXT column with the source JSON on the main rows. Downloaded PDFs/text under `data/raw/fishers/<source>/`.

## Storage location & scripts
- All modules under `scripts/fishers/`: `db.mjs` (schema + open), `civicclerk.mjs`, `youtube.mjs`, `parcels.mjs`, `zoning.mjs`, `run-all.mjs`, `lib/http.mjs` (fetch+retry+backoff), `lib/pdf.mjs` (PDF→text fallback).
- `package.json` scripts: `ingest:cc`, `ingest:yt`, `ingest:parcels`, `ingest:zoning`, `ingest:all`. Each accepts `--live` and `--limit=N` (for smoke tests). Example: `node scripts/fishers/civicclerk.mjs --backfill --limit=5`.
- Migrations: create tables idempotently (`CREATE TABLE IF NOT EXISTS`) in `db.mjs` on open.

---

## SOURCE 1 — CivicClerk (minutes + agenda packets + items + votes)
Base: `https://fishersin.api.civicclerk.com/v1` — OData v4, **public, no auth**. URL-encode `$`→`%24`, space→`%20`, `'`→`%27`.

### 1a. Events (backbone)
- List: `GET /Events?%24filter=startDateTime%20ge%202026-01-01T00:00:00Z&%24orderby=startDateTime%20asc&%24top=50&%24skip={N}` — paginate on `%24skip` until `value` empty.
- Pull **ALL** categories (do not pre-filter). Store `categoryName`. Boards include: `City Council`, `Plan Commission`, `Board of Zoning Appeals – Fishers`, `Board of Zoning Appeals - Fall Creek`, `Board of Public Works and Safety`, `Technical Advisory Committee`, `Nickel Plate Review Committee`, etc. (Plan Commission + BZA are where rezonings/variances live — make sure they land; they will, since we pull all.)
- `live` high-watermark: max `startDateTime` already stored, or `createdOn` > last run. Upsert on `event_id`.
- Useful event fields: `id, eventName, eventDescription, eventDate, startDateTime, categoryName, agendaId, agendaName, isPublished, youtubeVideoId, closedCaptionSourcePath, keywords`.

### 1b. Per-event published files (minutes / agenda / packet)
- Detail incl. files: `GET /Events?%24filter=id%20eq%20{eventId}` → object has `publishedFiles[]` inline, each `{ fileId, type, name, streamUrl, fileType }`. `type` ∈ {`Agenda`, `Agenda Packet`, `Minutes`}. Also top-level `agendaFile`, `minutesFile`.
- **Plain text first, PDF fallback.** Fetch text via bound function:
  - Try `GET /Events/GetEventFileStream(fileId={fileId},plainText=true)`
  - If that 400/404s, try `GET /Meetings/GetMeetingFileStream(fileId={fileId},plainText=true)` and/or add `fileType=1`.
  - Check `GetEventPlainTextFileStatus` / `GetPlainTextFileStatus` (functions exist in `$metadata`) to know if plain text is ready.
  - If no plain text: download the PDF (same function without `plainText`, or `streamUrl`), save under `data/raw/fishers/civicclerk/`, extract text with `lib/pdf.mjs` (use `pdf-parse` — add as dep) into the `plaintext` column and set `pdf_page_count`.
- Store `sha256` of raw bytes to detect changes.

### 1c. Agenda items + attachments + votes (entity-rich)
- Agenda items model (`AgendaObjItemsModel`) fields to capture: `id, agendaObjectItemNumber, agendaObjectItemOutlineNumberFull, agendaObjectItemName, agendaObjectItemDescription, agendaObjectItemHtmlContent, resolutionNumber, ordinanceNumber, resolutionFormattedNumber, ordinanceFormattedNumber, presenterName, fiscalImpactSummary, passFail, hasMotion, hasVote, hasSpeaker, sortOrder, parentId, agendaObjectItemMinutesHtmlContent, eventId`.
  - Nested: `attachmentsList[]` (`AgendaObjItemDocumentModel`: `id, fileName, contentType, documentTypeId, pdfVersionFullPath, txtMediaFullPath/mediaFullPath, isPublished`) → staff reports / applicant docs.
  - Nested: `minutesItemVotes[]` (`MeetingItemMinuteVoteApiModel`) → the actual votes.
- **Discover the exact retrieval URL** — inspect `$metadata` (entities `Meetings`, functions `GetMeetingItemMinutesVotes(id)`, `GetMeetingFile`) and, if needed, watch the portal's network calls at `https://fishersin.portal.civicclerk.com/event/{eventId}/files` in devtools logic. Likely one of: `GET /Meetings({agendaId})?%24expand=...`, a `GetMeeting`/`GetAgenda` function, or items exposed under the event. Probe with curl until you get real item rows; document the working URL in a comment.
- Votes: for each item with `hasVote`, call `GetMeetingItemMinutesVotes(id={itemId})`; store motion text, mover/seconder, outcome, tallies in `cc_votes` and per-member rows in `cc_vote_records`.
- If the agenda-items endpoint proves unavailable/locked, **still land events + files + minutes text** (the minutes plain text already contains votes/motions/who-spoke as narrative) and log the limitation in `ingest_runs.notes`. Do not block the whole pipeline on it.

---

## SOURCE 2 — YouTube meeting transcripts (timestamped)
- The join is free: each event carries `youtubeVideoId`. Backfill = every stored `cc_events.youtube_video_id` that is non-empty. Also accept the playlist `PLItzu5doxhheXv5mjOtY-WYGYFiYebMlj` (channel `UCB3AoHzPXzp4K-s4nTUCNcA`) to catch videos not yet linked from an event.
- Pull the transcript **with timestamps** (start seconds + duration + text per cue). Prefer no API key:
  - Try the `youtube-transcript` npm package, or fetch the timedtext track (`https://www.youtube.com/api/timedtext?...`) resolved from the watch page's caption track list.
  - If auto-captions are blocked or rate-limited, fall back to `yt-dlp --write-auto-sub --sub-format vtt --skip-download` if `yt-dlp` is on PATH; parse the VTT into cues. If neither works, mark the transcript row `status='unavailable'` and continue.
- Store one `yt_transcripts` row per video + N `yt_transcript_cues` rows.
- **LIMITATION to surface:** unauthenticated YouTube caption pulls are fragile (IP throttling, region blocks, videos with captions disabled). Report how many videos succeeded vs failed in `ingest_runs`.

---

## SOURCE 3 — Hamilton County parcels (bulk pull, not a scrape)
- FeatureServer: `https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0`
- Query paginated: `.../0/query?where={W}&outFields=*&returnGeometry=true&f=geojson&resultOffset={N}&resultRecordCount=2000` — page on `resultOffset` until fewer than 2000 features returned. Respect `maxRecordCount=2000`.
- Filter to Fishers: inspect distinct `LOCCITY` / `CORPLIMIT` first (`...&where=1=1&returnDistinctValues=true&outFields=CORPLIMIT&f=json`), then set `where` to the Fishers value(s) (likely `CORPLIMIT='Fishers'` or `LOCCITY='FISHERS'`). If unsure, pull `where=CORPLIMIT LIKE '%Fishers%' OR LOCCITY LIKE '%FISHERS%'`.
- Fields to store (see full list already confirmed): `FMTPRCLNO, STPRCLNO, LOCADDRESS, OWNNAME, DEEDEDOWNR, OWNADDRESS, LEGALDESC, PROPCLASS, PROPUSE, TAXDISTNAM, DEEDACRES, AVLAND, AVIMPROVE, AVTOTGROSS, TAX_YEAR, SUBDIVNAME, PROPERTYREPORT` + geometry as GeoJSON string in `geometry_geojson` + full `raw_json`.
- `PROPERTYREPORT` holds the assessor report id/url (secure2.hamiltoncounty.in.gov/propertyreports). **Do NOT scrape per-parcel assessor pages now** — store the id/url for later. The FeatureServer attrs already give owner + assessed values.
- Upsert on `OBJECTID` (or `FMTPRCLNO` if stable). This is a bulk snapshot; `live` mode = re-pull and upsert (optionally filter `EXPORTDATE`/`LSTXFRDATE` if incremental supported).

## SOURCE 4 (Tier 2) — Zoning districts
- Find the zoning layer under `https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/` (search the OpenData folder / a `Zoning` MapServer/FeatureServer). Fishers may publish its own city zoning GIS — if the county layer lacks Fishers districts, note it.
- Same paginated GeoJSON pull → `zoning_districts` (district code, name, geometry, raw). Extraction only.
- If no clean public zoning endpoint is found, write the finding to `ingest_runs.notes` and skip — do not block Tier-1.

---

## Schema (`data/fishers.db`) — extraction tables, no FKs enforced
```
cc_events(event_id PK, event_name, category_name, event_date, start_datetime, agenda_id,
          agenda_name, is_published, youtube_video_id, cc_source_path, keywords, raw_json, fetched_at)
cc_files(file_id PK, event_id, file_type, name, stream_url, has_plaintext INT,
         plaintext, local_pdf_path, pdf_page_count, sha256, fetched_at)
cc_agenda_items(item_id PK, event_id, agenda_id, outline_number, name, description_html,
         resolution_number, ordinance_number, resolution_formatted, ordinance_formatted,
         presenter_name, fiscal_impact_summary, pass_fail, has_motion INT, has_vote INT,
         has_speaker INT, sort_order, parent_item_id, minutes_html, raw_json, fetched_at)
cc_item_attachments(attachment_id PK, item_id, event_id, file_name, content_type, doc_type_id,
         pdf_full_path, txt_full_path, local_path, is_published INT, raw_json, fetched_at)
cc_votes(vote_id PK, item_id, event_id, motion_text, moved_by, seconded_by, outcome,
         ayes INT, nays INT, abstain INT, raw_json, fetched_at)
cc_vote_records(id PK autoincrement, vote_id, item_id, person_name, vote_value, raw_json)
yt_transcripts(video_id PK, event_id, source, language, status, fetched_at)
yt_transcript_cues(id PK autoincrement, video_id, start_seconds REAL, duration_seconds REAL,
         text, sort_order)
parcels(object_id PK, parcel_no, st_parcel_no, local_address, owner_name, deeded_owner,
         own_address, legal_desc, prop_class, prop_use, tax_dist_name, deed_acres REAL,
         av_land REAL, av_improve REAL, av_total_gross REAL, tax_year, subdiv_name,
         property_report_url, geometry_geojson, raw_json, fetched_at)
zoning_districts(object_id PK, district_code, district_name, geometry_geojson, raw_json, fetched_at)
ingest_runs(id PK autoincrement, source, mode, started_at, finished_at, high_watermark,
         rows_upserted INT, errors INT, status, notes)
```

## Acceptance (Codex must verify before finishing)
1. `npm run ingest:cc -- --backfill --limit=5` inserts ≥1 `cc_events` and ≥1 `cc_files` row with non-empty `plaintext` for at least one Minutes file. Print counts.
2. `npm run ingest:parcels -- --limit=2000` inserts parcels rows with non-null `owner_name` and `geometry_geojson`. Print count.
3. `npm run ingest:yt -- --limit=3` attempts transcripts for 3 stored video ids and reports success/fail counts (partial OK given the stated limitation).
4. Full `npm run ingest:all -- --backfill` runs end to end without an unhandled crash; failures are logged, not fatal.
5. Re-running any command does not duplicate rows (idempotent upsert verified by stable counts).
6. A short `scripts/fishers/README.md` documents each command, the working CivicClerk file/vote URLs discovered, and every limitation hit.

Commit in small, dated, conventional commits as you go (`feat(fishers): ...`). MIT-compatible, no secrets in code.
