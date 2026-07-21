const createCacheSql = `CREATE TABLE IF NOT EXISTS app_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  built_at TEXT NOT NULL
)`;

export function ensureCache(db) {
  if (!db) return false;
  db.exec(createCacheSql);
  return true;
}

export function readCache(db, key) {
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT payload FROM app_cache WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.payload) : null;
  } catch {
    return null;
  }
}

export function writeCache(db, key, payload) {
  if (!db) return false;
  ensureCache(db);
  db.prepare(
    "INSERT INTO app_cache(key,payload,built_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,built_at=excluded.built_at",
  ).run(key, JSON.stringify(payload), new Date().toISOString());
  return true;
}

export function cacheKeyForCase(caseNumber) {
  return `case:${String(caseNumber || "")
    .trim()
    .toUpperCase()}`;
}

export function readCaseCaches(db) {
  if (!db) return [];
  try {
    return db
      .prepare(
        "SELECT payload FROM app_cache WHERE key LIKE 'case:%' ORDER BY key",
      )
      .all()
      .flatMap((row) => {
        try {
          return [JSON.parse(row.payload)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function cacheHealth(db) {
  if (!db) return { keys: 0, built_at: null };
  try {
    ensureCache(db);
    const row = db
      .prepare(
        "SELECT count(*) AS keys,max(built_at) AS built_at FROM app_cache",
      )
      .get();
    return { keys: Number(row?.keys || 0), built_at: row?.built_at || null };
  } catch {
    return { keys: 0, built_at: null };
  }
}
