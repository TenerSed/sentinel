import neo4j from 'neo4j-driver';
import { env } from './env.mjs';
export function graphDriver() { const e=env(); if(!e.NEO4J_URI||!e.NEO4J_PASSWORD) throw new Error('Missing NEO4J_URI or NEO4J_PASSWORD in .env'); return neo4j.driver(e.NEO4J_URI, neo4j.auth.basic(e.NEO4J_USER||'neo4j',e.NEO4J_PASSWORD)); }
export async function counts(driver) { const s=driver.session(); try { const r=await s.run('MATCH (n) RETURN labels(n)[0] AS label,count(*) AS count ORDER BY label'); const e=await s.run('MATCH ()-[r]->() RETURN type(r) AS type,count(*) AS count ORDER BY type'); return {nodes:r.records.map(x=>({label:x.get('label'),count:x.get('count').toNumber()})),relationships:e.records.map(x=>({type:x.get('type'),count:x.get('count').toNumber()}))}; } finally { await s.close(); } }
