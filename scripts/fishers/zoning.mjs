import { openDb, startRun, finishRun, args, now } from './db.mjs';
import { json } from './lib/http.mjs';

const BASE = 'https://maps.fishers.in.us/arcgis/rest/services/Zoning/MapServer';
const PAGE_SIZE = 4000;
const upsert = `INSERT INTO zoning_districts VALUES (@object_id,@district_code,@district_name,@geometry_geojson,@raw_json,@fetched_at)
  ON CONFLICT(object_id) DO UPDATE SET district_code=excluded.district_code,district_name=excluded.district_name,geometry_geojson=excluded.geometry_geojson,raw_json=excluded.raw_json,fetched_at=excluded.fetched_at`;

async function layerFeatures(layerId) {
  const features = [];
  let offset = 0;
  for (;;) {
    const url = `${BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`;
    const page = await json(url);
    const rows = page.features || [];
    features.push(...rows);
    if (rows.length < PAGE_SIZE) return features;
    offset += rows.length;
  }
}

async function main() {
  const { mode } = args();
  const db = openDb();
  const run = startRun(db, 'zoning', mode).lastInsertRowid;
  let rows = 0, errors = 0;
  const notes = [];
  try {
    for (const layerId of [2, 1]) {
      try {
        for (const feature of await layerFeatures(layerId)) {
          const properties = feature.properties || {};
          const objectId = properties.OBJECTID;
          if (objectId === undefined || objectId === null) throw new Error(`layer ${layerId} feature has no OBJECTID`);
          const districtCode = properties.Zoning || (layerId === 1 ? properties.Districts || 'Overlay' : null);
          db.prepare(upsert).run({
            object_id: `${layerId}:${objectId}`,
            district_code: districtCode,
            district_name: layerId === 1 ? 'Overlay' : properties.Zoning,
            geometry_geojson: JSON.stringify(feature.geometry),
            raw_json: JSON.stringify({ layer_id: layerId, properties }),
            fetched_at: now(),
          });
          rows++;
        }
      } catch (error) { errors++; notes.push(`layer ${layerId}: ${error.message}`); }
    }
    finishRun(db, run, { rows, errors, notes: notes.join('\n'), status: 'completed' });
  } catch (error) {
    finishRun(db, run, { rows, errors: errors + 1, notes: `run error: ${error.message}`, status: 'completed' });
  }
  console.log(JSON.stringify({ source: 'zoning', districts: db.prepare('SELECT count(*) n FROM zoning_districts').get().n, rows, errors }, null, 2));
  db.close();
}

main();
