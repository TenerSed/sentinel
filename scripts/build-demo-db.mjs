import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(
  root,
  process.env.SENTINEL_SOURCE_DB || path.join("data", "fishers.db"),
);
const onboardingPath = path.join(root, "data", "lamplighter.db");
const targetPath = path.join(root, "data", "demo.db");
const temporaryPath = `${targetPath}.tmp`;
const SAMPLE_ADDRESS_LIMIT = 3_000;

if (!fs.existsSync(sourcePath)) {
  throw new Error(
    `Source database not found at ${sourcePath}. Set SENTINEL_SOURCE_DB to the extraction database.`,
  );
}

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const streetWords = new Map([
  ["road", "rd"],
  ["street", "st"],
  ["avenue", "ave"],
  ["boulevard", "blvd"],
  ["drive", "dr"],
  ["lane", "ln"],
  ["court", "ct"],
  ["circle", "cir"],
  ["trail", "trl"],
  ["trace", "trce"],
  ["parkway", "pkwy"],
  ["highway", "hwy"],
]);
const normalizeAddress = (value) =>
  clean(value)
    .split(",", 1)[0]
    .toLowerCase()
    .replace(/\b(east|west|north|south)\b/g, (word) => word[0])
    .replace(
      /\b(road|street|avenue|boulevard|drive|lane|court|circle|trail|trace|parkway|highway)\b/g,
      (word) => streetWords.get(word) || word,
    )
    .replace(/[^a-z0-9]/g, "");

function addressCandidates(value) {
  const address = clean(value).split(",", 1)[0];
  const candidates = [address];
  const combined = address.match(/^(\d+)\s*(?:&|and)\s*(\d+)\s+(.+)$/i);
  if (combined) {
    candidates.push(`${combined[1]} ${combined[3]}`, `${combined[2]} ${combined[3]}`);
  }
  return candidates.map(normalizeAddress).filter(Boolean);
}

function collectReferences(value, addresses, parcelNumbers, parentKey = "") {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (parentKey === "parcels" && typeof item === "string") addresses.add(item);
      collectReferences(item, addresses, parcelNumbers, parentKey);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "parcel_no" && item != null) parcelNumbers.add(String(item));
    if ((key === "address" || key === "local_address") && typeof item === "string") {
      addresses.add(item);
    }
    collectReferences(item, addresses, parcelNumbers, key);
  }
}

function hasTable(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
  );
}

function copyOnboardedMeetings(target) {
  const candidatePaths = [sourcePath, onboardingPath];
  const sourceWithTable = candidatePaths.find((filename) => {
    if (!fs.existsSync(filename)) return false;
    const candidate = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      return hasTable(candidate, "onboarded_meetings");
    } finally {
      candidate.close();
    }
  });
  if (!sourceWithTable) return 0;

  const onboarding = new Database(sourceWithTable, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const schema = onboarding
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='onboarded_meetings'")
      .get()?.sql;
    if (!schema) return 0;
    target.exec(schema);
    const rows = onboarding.prepare("SELECT * FROM onboarded_meetings").all();
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]);
    const insert = target.prepare(
      `INSERT INTO onboarded_meetings (${columns.map((name) => `"${name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    );
    target.transaction((items) => {
      for (const row of items) insert.run(...columns.map((name) => row[name]));
    })(rows);
    return rows.length;
  } finally {
    onboarding.close();
  }
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);

const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const target = new Database(temporaryPath);
let cacheCount = 0;
let referencedCount = 0;
let sampleCount = 0;
let onboardedCount = 0;

try {
  if (!hasTable(source, "app_cache") || !hasTable(source, "parcels")) {
    throw new Error("Source database must contain app_cache and parcels tables.");
  }

  target.pragma("journal_mode = DELETE");
  target.pragma("synchronous = OFF");
  target.exec(`
    CREATE TABLE app_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
    CREATE TABLE parcels (
      parcel_no TEXT,
      local_address TEXT,
      geometry_geojson TEXT
    );
  `);

  const cacheRows = source
    .prepare("SELECT key,payload,built_at FROM app_cache ORDER BY key")
    .all();
  const insertCache = target.prepare(
    "INSERT INTO app_cache(key,payload,built_at) VALUES(?,?,?)",
  );
  target.transaction((rows) => {
    for (const row of rows) insertCache.run(row.key, row.payload, row.built_at);
  })(cacheRows);
  cacheCount = cacheRows.length;

  const referencedAddresses = new Set();
  const referencedParcelNumbers = new Set();
  for (const row of cacheRows) {
    if (!row.key.startsWith("case:") && row.key !== "map:cases") continue;
    collectReferences(
      JSON.parse(row.payload),
      referencedAddresses,
      referencedParcelNumbers,
    );
  }
  const normalizedReferences = new Set(
    [...referencedAddresses].flatMap(addressCandidates),
  );

  const parcelRows = source
    .prepare(
      `SELECT parcel_no,local_address,geometry_geojson
       FROM parcels
       WHERE local_address IS NOT NULL AND local_address <> ''
       ORDER BY local_address COLLATE NOCASE, parcel_no`,
    )
    .iterate();
  const referenced = [];
  const sample = [];
  const selectedParcelNumbers = new Set();
  const sampledAddresses = new Set();
  for (const row of parcelRows) {
    const isReferenced =
      referencedParcelNumbers.has(String(row.parcel_no)) ||
      normalizedReferences.has(normalizeAddress(row.local_address));
    if (isReferenced) {
      referenced.push(row);
      selectedParcelNumbers.add(String(row.parcel_no));
      continue;
    }
    const addressKey = clean(row.local_address).toLowerCase();
    if (
      sample.length < SAMPLE_ADDRESS_LIMIT &&
      !sampledAddresses.has(addressKey)
    ) {
      sample.push(row);
      sampledAddresses.add(addressKey);
      selectedParcelNumbers.add(String(row.parcel_no));
    }
  }
  const insertParcel = target.prepare(
    "INSERT INTO parcels(parcel_no,local_address,geometry_geojson) VALUES(?,?,?)",
  );
  target.transaction((rows) => {
    for (const row of rows) {
      insertParcel.run(row.parcel_no, row.local_address, row.geometry_geojson);
    }
  })([...referenced, ...sample]);
  referencedCount = referenced.length;
  sampleCount = sample.length;

  target.exec(`
    CREATE INDEX idx_parcels_parcel_no ON parcels(parcel_no);
    CREATE INDEX idx_parcels_local_address_nocase
      ON parcels(local_address COLLATE NOCASE);
  `);
  onboardedCount = copyOnboardedMeetings(target);
  target.pragma("synchronous = FULL");
  target.exec("VACUUM");
} finally {
  source.close();
  target.close();
}

for (const suffix of ["-wal", "-shm"]) {
  const sidecarPath = `${targetPath}${suffix}`;
  if (fs.existsSync(sidecarPath)) fs.rmSync(sidecarPath);
}
fs.renameSync(temporaryPath, targetPath);
const bytes = fs.statSync(targetPath).size;
console.log(`Built ${path.relative(root, targetPath)}`);
console.log(`  app_cache: ${cacheCount} keys`);
console.log(`  parcels: ${referencedCount} referenced + ${sampleCount} address sample`);
console.log(`  onboarded_meetings: ${onboardedCount} rows`);
console.log(`  final size: ${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes} bytes)`);
