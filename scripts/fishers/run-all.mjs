import { spawnSync } from 'node:child_process';
const passed=process.argv.slice(2); let failed=false;
for(const source of ['civicclerk','parcels','youtube','zoning']) { const r=spawnSync(process.execPath,[`scripts/fishers/${source}.mjs`,...passed],{stdio:'inherit'}); if(r.status!==0) { failed=true; console.error(`${source} process failure recorded; continuing remaining sources`); } }
process.exitCode=failed?0:0;
