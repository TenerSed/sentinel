import crypto from "node:crypto";
import { ingestMeetings } from "./onboard.mjs";
import { ingestCityDocuments, citySlug } from "./city.mjs";

/**
 * In-memory job registry. A full ingest (page every meeting, then pull agenda
 * and minutes text) takes minutes, which is far too long to hold an HTTP
 * request open, so the endpoint returns a job id and the client polls.
 * Jobs are intentionally not persisted: the ingested data itself is durable in
 * SQLite, so a server restart loses only the progress readout, not the work.
 */
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function prune() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) if (job.finishedAtMs && job.finishedAtMs < cutoff) jobs.delete(id);
}

export function getJob(id) {
  prune();
  const job = jobs.get(String(id || ""));
  if (!job) return null;
  const { finishedAtMs, ...view } = job;
  return view;
}

export function startIngestJob({ vendor, slug, city, state, documents = true, maxMeetings = 25, budgetMs = 120_000 }) {
  prune();
  const id = crypto.randomUUID();
  const job = {
    job: id,
    city,
    citySlug: citySlug(city),
    vendor,
    vendorSlug: slug,
    stage: "queued",
    status: "running",
    meetings: 0,
    documents: 0,
    documentChars: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finishedAtMs: null,
  };
  jobs.set(id, job);

  (async () => {
    try {
      job.stage = "meetings";
      const result = await ingestMeetings(vendor, slug, city, {
        state,
        onProgress: (progress) => {
          job.meetings = progress.fetched || job.meetings;
        },
      });
      job.meetings = result.ingested;
      job.citySlug = result.citySlug;
      job.summary = result.summary;
      job.sample = result.sample;

      if (documents) {
        job.stage = "documents";
        const docStats = await ingestCityDocuments({
          citySlug: result.citySlug,
          maxMeetings,
          budgetMs,
          onProgress: (stats) => {
            job.documents = stats.documents;
            job.documentChars = stats.chars;
            job.meetingsScanned = stats.meetingsScanned;
          },
        });
        job.documents = docStats.documents;
        job.documentChars = docStats.chars;
        job.budgetExhausted = docStats.budgetExhausted;
        // Degrade honestly: surface the reason each failed document failed.
        if (docStats.failures.length) job.errors.push(...docStats.failures);
      }
      job.stage = "done";
      job.status = "done";
    } catch (error) {
      job.stage = "failed";
      job.status = "failed";
      job.errors.push(error?.message || "Ingest failed for an unknown reason.");
      job.errorCode = error?.code || "onboard_ingest_failed";
    } finally {
      job.finishedAt = new Date().toISOString();
      job.finishedAtMs = Date.now();
    }
  })();

  return getJob(id);
}
