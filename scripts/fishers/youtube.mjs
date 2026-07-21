import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { openDb, startRun, finishRun, args, now } from './db.mjs';
import { request } from './lib/http.mjs';

const execFileAsync = promisify(execFile);
const LOCAL_YT_DLP = path.resolve('.venv/bin/yt-dlp');

function json3Cues(payload) {
  const cues = [];
  for (const event of payload.events || []) {
    if (!Array.isArray(event.segs)) continue;
    const text = event.segs.map(segment => segment.utf8 || '').join('').trim();
    if (!text) continue;
    cues.push({ start: (event.tStartMs || 0) / 1000, duration: (event.dDurationMs || 0) / 1000, text });
  }
  return cues;
}

async function ytDlpBinary() {
  try { await fs.access(LOCAL_YT_DLP); return LOCAL_YT_DLP; } catch { return 'yt-dlp'; }
}

async function transcript(videoId) {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'fishers-yt-'));
  try {
    const binary = await ytDlpBinary();
    const output = path.join(tmpdir, '%(id)s.%(ext)s');
    let lastError = 'no English caption track';
    for (const language of ['en', 'en-US', 'en-orig']) {
      try {
        await execFileAsync(binary, [
          '--skip-download', '--write-auto-sub', '--sub-langs', language,
          '--sub-format', 'json3', '-o', output,
          `https://www.youtube.com/watch?v=${videoId}`,
        ], { timeout: 25_000, maxBuffer: 2 * 1024 * 1024 });
        const files = await fs.readdir(tmpdir);
        const json3 = files.find(file => file === `${videoId}.${language}.json3`) || files.find(file => file.startsWith(`${videoId}.`) && file.endsWith('.json3'));
        if (!json3) { lastError = `${language}: no json3 output`; continue; }
        const cues = json3Cues(JSON.parse(await fs.readFile(path.join(tmpdir, json3), 'utf8')));
        if (cues.length) return { language, cues };
        lastError = `${language}: caption file had no non-empty cues`;
      } catch (error) { lastError = `${language}: ${error.message}`; }
    }
    throw new Error(lastError);
  } finally { await fs.rm(tmpdir, { recursive: true, force: true }); }
}

async function playlistVideos() {
  const page = await (await request('https://www.youtube.com/playlist?list=PLItzu5doxhheXv5mjOtY-WYGYFiYebMlj')).text();
  return [...new Set([...page.matchAll(/"videoId":"([\w-]{11})"/g)].map(match => match[1]))];
}

function upsertTranscript(db, video, language, status) {
  db.prepare(`INSERT INTO yt_transcripts VALUES (?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET event_id=excluded.event_id,source=excluded.source,language=excluded.language,status=excluded.status,fetched_at=excluded.fetched_at`).run(video.video_id, video.event_id, 'yt-dlp-auto', language, status, now());
}

async function main() {
  const { mode, limit } = args();
  const db = openDb();
  const run = startRun(db, 'youtube', mode).lastInsertRowid;
  let success = 0, failed = 0;
  const notes = [];
  try {
    let videos = db.prepare("SELECT youtube_video_id video_id,event_id FROM cc_events WHERE trim(coalesce(youtube_video_id,''))<>'' ORDER BY start_datetime DESC").all();
    if (!videos.length) {
      const ids = await playlistVideos();
      videos = ids.map(video_id => ({ video_id, event_id: null }));
      notes.push(`No CivicClerk YouTube ids were available; used public Fishers playlist (${ids.length} videos discovered).`);
    }
    const requestedVideoId = process.argv.find(argument => argument.startsWith('--video='))?.slice('--video='.length);
    if (requestedVideoId) videos = [{ video_id: requestedVideoId, event_id: null }];
    else if (limit) videos = videos.slice(0, limit);
    const insertCue = db.prepare('INSERT INTO yt_transcript_cues(video_id,start_seconds,duration_seconds,text,sort_order) VALUES (?,?,?,?,?)');
    for (const [index, video] of videos.entries()) {
      try {
        const result = await transcript(video.video_id);
        db.prepare('DELETE FROM yt_transcript_cues WHERE video_id=?').run(video.video_id);
        for (const [sortOrder, cue] of result.cues.entries()) insertCue.run(video.video_id, cue.start, cue.duration, cue.text, sortOrder);
        upsertTranscript(db, video, result.language, 'ok');
        success++;
      } catch (error) {
        upsertTranscript(db, video, null, 'unavailable');
        failed++;
        notes.push(`${video.video_id}: ${error.message}`);
      }
      if ((index + 1) % 5 === 0) console.log(`youtube progress ${index + 1}/${videos.length}`);
    }
    finishRun(db, run, { rows: success, errors: failed, notes: `yt-dlp auto-captions can still be disabled, throttled, or unavailable.\n${notes.join('\n')}`, status: 'completed' });
  } catch (error) {
    finishRun(db, run, { errors: failed + 1, notes: `run error: ${error.message}`, status: 'completed' });
  }
  console.log(JSON.stringify({ source: 'youtube', attempted: success + failed, success, failed }, null, 2));
  db.close();
}

main();
