import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import neo4j from "neo4j-driver";
import {
  ensureCache,
  cacheKeyForCase,
  readCache,
  writeCache,
} from "../server/cache.mjs";
import { mapCases } from "../server/map.mjs";
import {
  homeHighlights,
  homeStats,
  landUseCaseNumbers,
  nearCase,
} from "../server/near.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch {
  /* .env is optional. */
}

process.env.ALLOW_SLOW_LLM = "1";
const force = process.argv.includes("--force");
const concurrencyArg = process.argv.find((arg) =>
  arg.startsWith("--concurrency="),
);
const concurrencyIndex = process.argv.indexOf("--concurrency");
const requestedConcurrency = concurrencyArg
  ? concurrencyArg.split("=")[1]
  : concurrencyIndex >= 0
    ? process.argv[concurrencyIndex + 1]
    : "8";
const concurrency = Math.min(
  32,
  Math.max(1, Number.parseInt(requestedConcurrency || "8", 10) || 8),
);

if (!process.env.NEO4J_URI || !process.env.NEO4J_PASSWORD) {
  console.error("Snapshot requires NEO4J_URI and NEO4J_PASSWORD.");
  process.exitCode = 1;
} else {
  const db = new Database(path.join(root, "data", "fishers.db"), {
    fileMustExist: true,
  });
  db.pragma("journal_mode = WAL");
  ensureCache(db);
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD,
    ),
    { connectionTimeout: 5000 },
  );
  let built = 0,
    failed = 0,
    skipped = 0,
    processedCases = 0;

  const build = async (key, work) => {
    if (!force && readCache(db, key) !== null) {
      skipped += 1;
      return;
    }
    try {
      const payload = await work();
      writeCache(db, key, payload);
      built += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[failed] ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  try {
    await driver.verifyConnectivity();
    await build("stats", () => homeStats(driver, db));
    await build("highlights", () => homeHighlights(driver));
    await build("map:cases", () => mapCases(driver, db));
    const cases = await landUseCaseNumbers(driver);
    console.log(
      `Snapshotting ${cases.length} land-use cases with concurrency ${concurrency}${force ? " (force)" : ""}.`,
    );
    let next = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= cases.length) return;
        const caseNumber = cases[index];
        await build(cacheKeyForCase(caseNumber), () =>
          nearCase(driver, db, caseNumber),
        );
        processedCases += 1;
        if (processedCases % 10 === 0 || processedCases === cases.length)
          console.log(
            `Progress ${processedCases}/${cases.length} · built ${built} · failed ${failed} · skipped ${skipped}`,
          );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, Math.max(1, cases.length)) },
        worker,
      ),
    );
  } catch (error) {
    failed += 1;
    console.error(
      `[failed] snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    console.log(
      `Snapshot complete · built ${built} · failed ${failed} · skipped ${skipped}`,
    );
    await driver.close();
    db.close();
  }
}
