// SSRF guard for endpoints that fetch a caller-supplied URL.
//
// The adapter-synthesis route accepts a URL and fetches it server-side, which
// would otherwise let a caller reach loopback, link-local, cloud metadata, or
// anything else routable from this host. Every outbound fetch driven by user
// input goes through safeFetch.
//
// Two independent gates: the hostname must belong to a known civic-data vendor,
// AND every address it resolves to must be public. Redirects are followed
// manually so each hop is re-validated rather than trusted.

import dns from "node:dns/promises";
import net from "node:net";

// Municipal-data vendors plus the open geodata hosts the pipeline already uses.
const ALLOWED_SUFFIXES = [
  "legistar.com",
  // Legistar serves attachment files from a separate document host.
  "legistar1.com",
  "legistar2.com",
  "civicclerk.com",
  "primegov.com",
  "escribemeet.com",
  "novusagenda.com",
  "boarddocs.com",
  "granicus.com",
  "civicplus.com",
  "municode.com",
  "iqm2.com",
  "arcgis.com",
  "opendata.arcgis.com",
];

const MAX_REDIRECTS = 3;

export function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return ALLOWED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** True for any address that must never be reachable from a user-supplied URL. */
export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (!version) return true;
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd"))
    return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged on the embedded address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error("That URL could not be parsed."), {
      status: 400,
      code: "invalid_url",
    });
  }
  if (parsed.protocol !== "https:")
    throw Object.assign(new Error("Only https URLs may be fetched."), {
      status: 400,
      code: "invalid_scheme",
    });
  if (!hostAllowed(parsed.hostname))
    throw Object.assign(
      new Error(
        `"${parsed.hostname}" is not a recognised civic-data vendor host. Allowed: ${ALLOWED_SUFFIXES.join(", ")}.`,
      ),
      { status: 403, code: "host_not_allowed" },
    );
  // Resolve and check EVERY record: one public A record must not smuggle in a
  // private AAAA record.
  let records = [];
  try {
    records = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw Object.assign(new Error(`"${parsed.hostname}" could not be resolved.`), {
      status: 502,
      code: "dns_failed",
    });
  }
  if (!records.length)
    throw Object.assign(new Error(`"${parsed.hostname}" resolved to no address.`), {
      status: 502,
      code: "dns_empty",
    });
  for (const record of records)
    if (isPrivateAddress(record.address))
      throw Object.assign(
        new Error(`"${parsed.hostname}" resolves to a non-public address.`),
        { status: 403, code: "private_address" },
      );
  return parsed;
}

/**
 * Drop-in replacement for fetch() for any URL that originated from a request.
 * Redirects are handled manually so each hop passes the same checks.
 */
export async function safeFetch(rawUrl, init = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = await assertPublicUrl(current);
    const response = await fetch(parsed.toString(), {
      ...init,
      redirect: "manual",
      signal: init.signal || AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, parsed).toString();
      continue;
    }
    return response;
  }
  throw Object.assign(new Error("Too many redirects while fetching that URL."), {
    status: 502,
    code: "too_many_redirects",
  });
}
