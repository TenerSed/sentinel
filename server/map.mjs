import { centroid } from "./near.mjs";

let casesCache = null;

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const status = (value) =>
  /approv/i.test(String(value || ""))
    ? "APPROVED"
    : /den|reject/i.test(String(value || ""))
      ? "DENIED"
      : /withdraw/i.test(String(value || ""))
        ? "WITHDRAWN"
        : /table|continu/i.test(String(value || ""))
          ? "TABLED"
          : "PENDING";
const landUseNumber = /^(RZ|PUD|VA|SE|ANX|TA|SUP|DP|PC)-?\d/i;
const landUseType = /(rezon|varianc|pud|annex|special[ -]?exception|plat)/i;
const inFishers = (point) =>
  point.lat >= 39.88 &&
  point.lat <= 40.05 &&
  point.lon >= -86.15 &&
  point.lon <= -85.85;
const cap = (value, length = 90) =>
  value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
const headline = (item) => {
  const title = String(item.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (title) return title.slice(0, 120);
  const request = String(item.request || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^consideration of (?:a|an|the)\s+/i, "");
  const clause = request.split(/[.;]/, 1)[0].trim();
  if (clause) return cap(clause.charAt(0).toUpperCase() + clause.slice(1));
  const prefix = String(item.case_number || "")
    .match(/^(RZ|PUD|VA|SE|ANX|TA)/i)?.[1]
    ?.toUpperCase();
  const address = String(item.address || "").trim();
  const atAddress = address ? ` at ${address}` : "";
  if (prefix === "RZ") return `Rezoning${atAddress}`;
  if (prefix === "VA") return `Variance${atAddress}`;
  if (prefix === "PUD") return `PUD amendment${atAddress}`;
  if (prefix === "SE") return `Special exception${atAddress}`;
  if (prefix === "ANX") return `Annexation${atAddress}`;
  if (prefix === "TA") return "Text amendment";
  return address ? `Land-use case at ${address}` : "Land-use case";
};
const record = (row) =>
  Object.fromEntries(
    Object.entries(row.toObject()).map(([key, value]) => [
      key,
      typeof value?.toNumber === "function" ? value.toNumber() : value,
    ]),
  );

export async function mapCases(driver, db) {
  if (casesCache) return casesCache;
  if (!driver || !db) return [];
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (c:Case)-[:CONCERNS]->(p:Parcel) WHERE c.case_number IS NOT NULL AND p.parcel_no IS NOT NULL RETURN c.case_number AS case_number,c.case_type AS case_type,c.title AS title,c.request AS request,c.status AS status,p.parcel_no AS parcel_no",
    );
    const geometryFor = db.prepare(
      "SELECT local_address,geometry_geojson FROM parcels WHERE parcel_no=? LIMIT 1",
    );
    const chosen = new Map();
    for (const raw of result.records.map(record)) {
      const key = normalize(raw.case_number);
      if (
        !key ||
        chosen.has(key) ||
        (!landUseNumber.test(String(raw.case_number || "")) &&
          !landUseType.test(String(raw.case_type || "")))
      )
        continue;
      const parcel = geometryFor.get(raw.parcel_no);
      const point = centroid(parcel?.geometry_geojson);
      if (
        !point ||
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lon) ||
        !inFishers(point)
      )
        continue;
      const address = String(parcel.local_address || "").trim();
      chosen.set(key, {
        case_number: String(raw.case_number),
        headline: headline({ ...raw, address }),
        status: status(raw.status),
        lat: point.lat,
        lng: point.lon,
        address: address || "Fishers parcel",
      });
    }
    casesCache = [...chosen.values()].sort((a, b) =>
      a.case_number.localeCompare(b.case_number),
    );
    return casesCache;
  } finally {
    await session.close();
  }
}

export function mapParcel(db, address) {
  const requested = String(address || "").trim();
  if (!db || !requested) return { error: "not_found" };
  const exact = db
    .prepare(
      "SELECT local_address,geometry_geojson FROM parcels WHERE local_address = ? COLLATE NOCASE LIMIT 1",
    )
    .get(requested);
  const parcel =
    exact ||
    db
      .prepare(
        "SELECT local_address,geometry_geojson FROM parcels WHERE local_address LIKE ? COLLATE NOCASE ORDER BY length(local_address) LIMIT 1",
      )
      .get(`${requested}%`);
  const point = centroid(parcel?.geometry_geojson);
  if (!parcel || !point) return { error: "not_found" };
  try {
    const geometry =
      typeof parcel.geometry_geojson === "string"
        ? JSON.parse(parcel.geometry_geojson)
        : parcel.geometry_geojson;
    if (!geometry?.coordinates) return { error: "not_found" };
    return {
      address: parcel.local_address,
      lat: point.lat,
      lng: point.lon,
      polygon: geometry.coordinates,
    };
  } catch {
    return { error: "not_found" };
  }
}
