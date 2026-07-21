export const NODE_KEYS = { Meeting:'event_id', Case:'case_number', Parcel:'parcel_no', ZoningDistrict:'code', Person:'name_normalized', Organization:'name_normalized', Document:'doc_id' };
export const NODE_LABELS = new Set(Object.keys(NODE_KEYS));
export const REL_TYPES = new Set(['HEARD_AT','CONCERNS','REZONE_FROM','REZONE_TO','APPLICANT_FOR','REPRESENTS','SPOKE_AT','MADE_MOTION','VOTED','CURRENTLY_ZONED','OWNED_BY','HAS_DOCUMENT','EVIDENCED_BY']);
export const PROVENANCE = ['source','source_id','char_start','char_end','start_seconds','confidence','extractor'];
export function normalizeName(name='') { return name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim(); }
export function normalizeCase(value='') { return value.toUpperCase().replace(/\s+/g,' ').trim(); }
