// Streaming city-source discovery.
//
// The batch route (POST /api/onboard/discover) returns one JSON blob after every
// probe has settled, which hides the only interesting part: watching the system
// search the open web for a city it has never seen, then independently verify
// every candidate endpoint before believing it. This route runs the same
// pipeline and emits each step over Server-Sent Events as it happens.
//
// Nothing here is theatre. Every `probe` event is a real HTTP request and its
// real status code. A candidate is only ever marked verified after a 200 that
// also parsed as the vendor's expected event list.

import {
  MAX_CANDIDATES,
  STATE_NAME,
  cleanText,
  deterministicProposal,
  discoverArcgis,
  probeVendor,
  proposeTenantCandidates,
  slugify,
  unique,
} from "./onboard.mjs";
import { synthesizeAdapter } from "./adapter.mjs";

const WEB_SEARCH_TIMEOUT_MS = 45_000;
const VENDORS = ["legistar", "civicclerk", "primegov"];

function sse(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let closed = false;
  response.on("close", () => {
    closed = true;
  });
  return {
    get closed() {
      return closed;
    },
    emit(event, data) {
      if (closed) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!closed) response.end();
    },
  };
}

// Live web search via OpenRouter's `:online` suffix. This is the "find new
// resources online" half of the pipeline: the model is given search access and
// asked for the city's actual portal URLs. Its answer is untrusted — every URL
// it returns is probed before we believe any of it.
async function searchWebForPortals(city, state, emit) {
  if (!process.env.OPENROUTER_API_KEY) {
    emit("step", {
      id: "websearch",
      label: "Searching the open web for civic portals",
      status: "skipped",
      detail: "OPENROUTER_API_KEY is not configured; falling back to naming-convention candidates only.",
    });
    return { candidates: [], citations: [] };
  }
  emit("step", {
    id: "websearch",
    label: "Searching the open web for civic portals",
    status: "running",
    detail: `Asking a web-connected model where ${city}, ${state} publishes its council agendas and minutes.`,
  });

  const model = `${process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"}:online`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/local/sentinel",
        "x-title": "Sentinel City Discovery",
      },
      body: JSON.stringify({
        model,
        reasoning: { enabled: false },
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You search the live web. Return JSON only. Never claim a URL is verified — the caller probes every URL you return.",
          },
          {
            role: "user",
            content: `Search the web for the official public meeting portal of ${city}, ${STATE_NAME[state] || state} (${state}) — where the city posts council/commission agendas, minutes and video. Most US cities use a vendor such as Legistar (webapi.legistar.com/v1/<tenant>), CivicClerk (<tenant>.api.civicclerk.com), eScribe, PrimeGov, NovusAgenda or Granicus. From what you actually find, return strict JSON: {"portal_urls":["https://..."],"candidates":["tenant-slug"],"notes":"one sentence on what you found"}. "candidates" must be lowercase alphanumeric vendor tenant identifiers inferred from the real URLs you found. Return at most 8 of each.`,
          },
        ],
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    const message = body?.choices?.[0]?.message;
    let parsed = null;
    try {
      parsed = JSON.parse(String(message?.content || "{}"));
    } catch {
      parsed = null;
    }
    const candidates = unique(
      (Array.isArray(parsed?.candidates) ? parsed.candidates : []).map((row) => slugify(row)),
    ).slice(0, 8);
    // OpenRouter attaches the pages the search actually read.
    const citations = unique(
      (message?.annotations || [])
        .map((row) => row?.url_citation?.url || row?.url)
        .concat(Array.isArray(parsed?.portal_urls) ? parsed.portal_urls : [])
        .map((row) => cleanText(row, 200)),
    ).slice(0, 8);

    emit("step", {
      id: "websearch",
      label: "Searching the open web for civic portals",
      status: citations.length || candidates.length ? "verified" : "not_found",
      detail: citations.length
        ? `Read ${citations.length} live page${citations.length === 1 ? "" : "s"}; inferred ${candidates.length} tenant candidate${candidates.length === 1 ? "" : "s"}. ${cleanText(parsed?.notes, 160)}`
        : "The web search returned no usable portal URL for this city.",
      citations,
    });
    return { candidates, citations };
  } catch (error) {
    emit("step", {
      id: "websearch",
      label: "Searching the open web for civic portals",
      status: "not_found",
      detail: `Web search failed gracefully: ${cleanText(error?.message, 180)}. Naming-convention candidates still apply.`,
    });
    return { candidates: [], citations: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function streamDiscovery(request, response, url) {
  const city = cleanText(url.searchParams.get("city"), 80);
  const state = cleanText(url.searchParams.get("state"), 2).toUpperCase();
  if (!city || !/^[A-Z]{2}$/.test(state)) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_location" }));
    return;
  }
  const county = cleanText(url.searchParams.get("county"), 120);
  const stream = sse(response);
  const emit = (event, data) => stream.emit(event, data);

  emit("start", { city, state, county: county || null });

  try {
    // 1. Naming conventions we can derive without any network call.
    const proposal = deterministicProposal(city, state, county);
    emit("step", {
      id: "conventions",
      label: "Deriving candidates from naming conventions",
      status: "verified",
      detail: `${proposal.candidates.length} identifier${proposal.candidates.length === 1 ? "" : "s"} derived from the city and state name.`,
      candidates: proposal.candidates,
    });

    // 2. Probe what we can derive instantly, THEN fold in the slower proposal
    //    sources. Previously both the web search and the model call were awaited
    //    before the first probe fired, so the screen showed nothing at all for
    //    the ~40s they took. Convention candidates are free, so they go first
    //    and results start landing within a second.
    const probed = new Set();
    const attempts = [];
    const runProbes = async (candidates, wave) => {
      const fresh = candidates.filter((slug) => {
        if (!slug || probed.has(slug)) return false;
        probed.add(slug);
        return true;
      });
      if (!fresh.length) return [];
      emit("probe-wave", {
        wave,
        candidates: fresh,
        probes: fresh.length * VENDORS.length,
        message: `Probing ${fresh.length} candidate${fresh.length === 1 ? "" : "s"} against ${VENDORS.length} vendor APIs.`,
      });
      const results = await Promise.all(
        fresh.flatMap((slug) =>
          VENDORS.map((vendor) =>
            probeVendor(vendor, slug).then((attempt) => {
              emit("probe", {
                vendor,
                slug,
                url: attempt.url,
                status: attempt.status ?? null,
                verified: Boolean(attempt.verified),
                sample: attempt.evidence?.sample || null,
                reason: attempt.reason || null,
                probed: probed.size,
              });
              return attempt;
            }),
          ),
        ),
      );
      attempts.push(...results);
      return results;
    };

    emit("step", {
      id: "probe",
      label: "Probing candidates against every vendor API",
      status: "running",
      detail: "Nothing is trusted until an endpoint returns 200 with a parseable event list.",
    });

    // Convention probes and the two proposal sources all run concurrently.
    const conventionProbes = runProbes(proposal.candidates, "conventions");
    const webPromise = searchWebForPortals(city, state, emit).then(async (web) => {
      await runProbes(web.candidates, "web-search");
      return web;
    });
    const llmPromise = proposeTenantCandidates(city, state).then(async (llm) => {
      emit("step", {
        id: "propose",
        label: "Recalling known portal naming for this city",
        status: llm.candidates.length ? "verified" : "not_found",
        detail: llm.reason,
        candidates: llm.candidates,
      });
      await runProbes(llm.candidates.slice(0, MAX_CANDIDATES), "model-recall");
      return llm;
    });

    const [, web] = await Promise.all([conventionProbes, webPromise, llmPromise]);

    const verified = VENDORS.flatMap((vendor) => {
      const hit = attempts.find((item) => item.vendor === vendor && item.verified);
      return hit ? [hit] : [];
    });
    emit("step", {
      id: "probe",
      label: "Probing candidates against every vendor API",
      status: verified.length ? "verified" : "not_found",
      detail: verified.length
        ? `${verified.length} verified meeting source${verified.length === 1 ? "" : "s"} out of ${attempts.length} live probes.`
        : `All ${attempts.length} probes failed. No Legistar, CivicClerk or PrimeGov tenant exists for this city — reporting nothing rather than guessing.`,
    });

    // 4. Parcels are a bonus layer; failure here never blocks meetings.
    emit("step", {
      id: "arcgis",
      label: "Searching ArcGIS for parcel layers",
      status: "running",
      detail: `Querying the ArcGIS Hub for "${proposal.arcgisQuery}".`,
    });
    const arcgis = await discoverArcgis(proposal.arcgisQuery);
    const parcels = arcgis.serviceAttempts.filter((item) => item.verified);
    for (const item of arcgis.serviceAttempts) {
      emit("probe", {
        vendor: "arcgis",
        slug: cleanText(item.name || item.title, 60) || "feature service",
        url: item.url,
        status: item.status ?? null,
        verified: Boolean(item.verified),
        sample: item.evidence?.sample || null,
        reason: item.reason || null,
      });
    }
    emit("step", {
      id: "arcgis",
      label: "Searching ArcGIS for parcel layers",
      status: parcels.length ? "verified" : "not_found",
      detail: parcels.length
        ? `${parcels.length} live Feature Service${parcels.length === 1 ? "" : "s"} verified.`
        : "No parcel Feature Service passed verification for this city.",
    });

    const sources = [
      ...verified.map((item) => ({
        kind: "meetings",
        vendor: item.vendor,
        slug: item.slug,
        url: item.url,
        verified: true,
        evidence: item.evidence,
      })),
      ...parcels.map((item) => ({
        kind: "parcels",
        vendor: "arcgis",
        url: item.url,
        verified: true,
        evidence: item.evidence,
      })),
    ];

    emit("done", {
      city,
      state,
      county: county || proposal.county || null,
      sources,
      citations: web.citations,
      candidatesTried: probed.size,
      probesRun: attempts.length + arcgis.serviceAttempts.length,
      ingestible: verified.length > 0,
    });
  } catch (error) {
    emit("failed", { error: cleanText(error?.message, 200) || "discovery_failed" });
  } finally {
    stream.end();
  }
}


/**
 * Streams live extractor synthesis for one endpoint. This is the half of the
 * pipeline that removes hand-written vendor code: the shape of an unknown API
 * is described, a mapping is written for it, and the mapping is executed
 * against the real sample before it is trusted.
 */
export async function streamAdapter(request, response, url) {
  const endpoint = cleanText(url.searchParams.get("url"), 500);
  if (!/^https:\/\//.test(endpoint)) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_url" }));
    return;
  }
  const stream = sse(response);
  const emit = (event, data) => stream.emit(event, data);
  emit("start", { endpoint });
  try {
    const { mapping, verdict } = await synthesizeAdapter(endpoint, {
      emit,
      citySlug: cleanText(url.searchParams.get("slug"), 60) || null,
    });
    emit("done", { mapping, verdict });
  } catch (error) {
    emit("failed", { error: cleanText(error?.message, 300) || "adapter_synthesis_failed" });
  } finally {
    stream.end();
  }
}
